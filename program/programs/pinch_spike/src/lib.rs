// Pinch's Arcade - the claw program (built on the verified spike: delegation, permission,
// scoped VRF request and commit all unchanged from the run that passed on devnet).
//
// Rules live in game.rs (pure integer maths, unit-tested, cross-checked against the JS verifier).
// Flow per drop: drop_claw seals the account AND requests VRF in one transaction;
// the VRF callback writes the roll while sealed; reveal (set_privacy false) opens the seal.
use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use ephemeral_rollups_sdk::{
    access_control::{
        instructions::{
            CloseEphemeralPermissionCpi, CreateEphemeralPermissionCpi, UpdateEphemeralPermissionCpi,
        },
        structs::{
            EphemeralMembersArgs, EphemeralPermission, Member, PERMISSION_SEED, TX_BALANCES_FLAG,
            TX_LOGS_FLAG, TX_MESSAGE_FLAG,
        },
    },
    anchor::{commit, delegate, ephemeral, vrf, vrf_callback},
    consts::{EPHEMERAL_VAULT_ID, MAGIC_PROGRAM_ID, PERMISSION_PROGRAM_ID},
    cpi::DelegateConfig,
    ephem::MagicIntentBundleBuilder,
    vrf::{
        self,
        instructions::{create_request_scoped_randomness_ix, RequestRandomnessParams},
        types::SerializableAccountMeta,
    },
};

mod game;
use game::*;

declare_id!("11111111111111111111111111111111"); // `anchor keys sync` rewrites this

pub const SESSION_SEED: &[u8] = b"claw";
pub const RING: usize = 8; // receipts kept on chain
pub const START_PEARLS: u32 = 100;
pub const VRF_TIMEOUT_SECS: i64 = 120; // docs: an unfulfilled request can be purged ~2 min after
pub const OUT_PENDING: u8 = 0;
pub const OUT_MISS: u8 = 1;
pub const OUT_SLIP: u8 = 2;
pub const OUT_HOLD: u8 = 3;
pub const OUT_VOID: u8 = 4;
pub const SESSION_SPACE: usize = 8 + 512; // data is ~461 bytes (see Session)

#[ephemeral]
#[program]
pub mod pinch_spike {
    use super::*;

    /// Base layer. Create the player's arcade account and pre-fund the permission rent.
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let fresh = ctx.accounts.session.authority == Pubkey::default();
        if fresh {
            transfer(
                CpiContext::new(
                    ctx.accounts.system_program.key(),
                    Transfer {
                        from: ctx.accounts.authority.to_account_info(),
                        to: ctx.accounts.session.to_account_info(),
                    },
                ),
                ephemeral_rollups_sdk::ephemeral_accounts::rent(
                    EphemeralPermission::size_of(1) as u32
                ),
            )?;
            let s = &mut ctx.accounts.session;
            s.authority = ctx.accounts.authority.key();
            s.pearls = START_PEARLS;
        }
        Ok(())
    }

    /// Base layer. Delegate to the validator passed as the optional `validator` account.
    pub fn delegate(ctx: Context<DelegateSession>) -> Result<()> {
        if ctx.accounts.session.owner != &ephemeral_rollups_sdk::id() {
            let validator = ctx.accounts.validator.as_ref();
            ctx.accounts.delegate_session(
                &ctx.accounts.authority,
                &[SESSION_SEED, ctx.accounts.authority.key().as_ref()],
                DelegateConfig {
                    validator: validator.map(|v| v.key()),
                    ..Default::default()
                },
            )?;
        } else {
            msg!("Session already delegated");
        }
        Ok(())
    }

    /// ER. Create the ephemeral permission (starts public). Idempotent.
    pub fn init_permission(ctx: Context<PermissionContext>) -> Result<()> {
        if ctx.accounts.permission.lamports() > 0 {
            msg!("Permission already exists, skipping creation");
            return Ok(());
        }
        let signers = [
            SESSION_SEED,
            ctx.accounts.session.authority.as_ref(),
            &[ctx.bumps.session],
        ];
        CreateEphemeralPermissionCpi {
            payer: ctx.accounts.session.to_account_info(),
            permissioned_account: ctx.accounts.session.to_account_info(),
            permission: ctx.accounts.permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            args: EphemeralMembersArgs {
                is_private: false,
                members: vec![],
            },
        }
        .invoke_signed(&[&signers])?;
        Ok(())
    }

    /// ER. Seal / open the account.
    ///   (true,  false) -> sealed: hidden from every wallet
    ///   (true,  true)  -> private, only the player can read
    ///   (false, _)     -> public (this is the REVEAL)
    pub fn set_privacy(
        ctx: Context<PermissionContext>,
        is_private: bool,
        player_can_read: bool,
    ) -> Result<()> {
        let signers = [
            SESSION_SEED,
            ctx.accounts.session.authority.as_ref(),
            &[ctx.bumps.session],
        ];
        let members = if is_private && player_can_read {
            vec![Member {
                flags: TX_LOGS_FLAG | TX_MESSAGE_FLAG | TX_BALANCES_FLAG,
                pubkey: ctx.accounts.session.authority,
            }]
        } else {
            vec![]
        };
        UpdateEphemeralPermissionCpi {
            payer: ctx.accounts.session.to_account_info(),
            permissioned_account: ctx.accounts.session.to_account_info(),
            permission: ctx.accounts.permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            authority: ctx.accounts.session.to_account_info(),
            authority_is_signer: false,
            args: EphemeralMembersArgs {
                is_private,
                members,
            },
        }
        .invoke_signed(&[&signers])?;
        Ok(())
    }

    /// ER. THE DROP. Takes the ticket, fixes the aim and the hold chance on chain,
    /// SEALS the account, and requests the VRF roll, all in this one transaction.
    /// A drop with nothing under the claw resolves at once as a miss (no roll needed).
    pub fn drop_claw(
        ctx: Context<DropClaw>,
        machine: u8,
        x_pm: u16,
        client_seed: u8,
    ) -> Result<()> {
        require!((machine as usize) < MACHINES.len(), ClawErr::BadMachine);
        require!(x_pm <= 1000, ClawErr::BadAim);
        let bump = ctx.bumps.session;
        let auth = ctx.accounts.session.authority;
        let need_vrf: bool;
        let round_byte: u8;
        {
            let s = &mut ctx.accounts.session;
            require!(s.status == 0, ClawErr::Busy);
            let ticket = MACHINES[machine as usize].ticket;
            require!(s.pearls >= ticket, ClawErr::Broke);
            let round = s.round;
            let kinds = pit_kinds(pit_seed(&auth.to_bytes(), round, machine), machine);
            s.pearls -= ticket;
            s.paid += ticket;
            s.drops += 1;
            s.round = round.wrapping_add(1);
            let mut rc = Receipt {
                round,
                machine,
                x_pm,
                slot: NONE,
                kind: NONE,
                centering: 0,
                chance: 0,
                outcome: OUT_MISS,
                roll: 0,
                randomness: [0u8; 32],
            };
            match pick_target(machine, x_pm as u32) {
                None => {
                    need_vrf = false;
                }
                Some((slot, c)) => {
                    let kind = kinds[slot];
                    rc.slot = slot as u8;
                    rc.kind = kind;
                    rc.centering = c as u16;
                    rc.chance = chance_bp(machine, kind, c) as u16;
                    rc.outcome = OUT_PENDING;
                    s.status = 1;
                    s.pending_ts = Clock::get()?.unix_timestamp;
                    need_vrf = true;
                }
            }
            s.ring[(round as usize) % RING] = rc;
            round_byte = round as u8;
        }
        if !need_vrf {
            return Ok(());
        }

        // 1) SEAL, in this same transaction, before the randomness is even requested
        let signers = [SESSION_SEED, auth.as_ref(), &[bump]];
        UpdateEphemeralPermissionCpi {
            payer: ctx.accounts.session.to_account_info(),
            permissioned_account: ctx.accounts.session.to_account_info(),
            permission: ctx.accounts.permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            authority: ctx.accounts.session.to_account_info(),
            authority_is_signer: false,
            args: EphemeralMembersArgs {
                is_private: true,
                members: vec![],
            },
        }
        .invoke_signed(&[&signers])?;

        // 2) request the VRF roll; the callback echoes the round so a stale one is ignored
        let params = RequestRandomnessParams {
            payer: ctx.accounts.payer.key(),
            oracle_queue: ctx.accounts.oracle_queue.key(),
            callback_program_id: ID,
            callback_discriminator: instruction::CallbackDrop::DISCRIMINATOR.to_vec(),
            caller_seed: [client_seed; 32],
            accounts_metas: Some(vec![SerializableAccountMeta {
                pubkey: ctx.accounts.session.key(),
                is_signer: false,
                is_writable: true,
            }]),
            callback_args: Some(vec![round_byte]),
            ..Default::default()
        };
        let ix = create_request_scoped_randomness_ix(params);
        ctx.accounts
            .invoke_signed_vrf(&ctx.accounts.payer.to_account_info(), &ix)?;
        Ok(())
    }

    /// Only the VRF program can call this (#[vrf_callback] enforces the signer).
    /// The roll, the verdict and the prize are all decided here, from public rules.
    pub fn callback_drop(
        ctx: Context<CallbackDrop>,
        randomness: [u8; 32],
        round_byte: u8,
    ) -> Result<()> {
        let s = &mut ctx.accounts.session;
        if s.status != 1 {
            msg!("stale callback ignored (nothing pending)");
            return Ok(());
        }
        let round = s.round.wrapping_sub(1);
        if round as u8 != round_byte {
            msg!("stale callback ignored (round mismatch)");
            return Ok(());
        }
        let idx = (round as usize) % RING;
        let roll = roll_from_randomness(&randomness);
        let chance = s.ring[idx].chance as u32;
        let kind = s.ring[idx].kind;
        let hold = roll <= chance;
        {
            let rc = &mut s.ring[idx];
            rc.roll = roll as u16;
            rc.randomness = randomness;
            rc.outcome = if hold { OUT_HOLD } else { OUT_SLIP };
        }
        if hold {
            let v = VALUE[kind as usize];
            s.pearls += v;
            s.won += v;
            s.wins += 1;
            s.inventory[kind as usize] = s.inventory[kind as usize].saturating_add(1);
        }
        s.status = 0;
        msg!("roll={} chance={} hold={}", roll, chance, hold);
        Ok(())
    }

    /// ER. If the oracle never answers (docs: a request can be purged after ~2 minutes),
    /// the player gets the ticket back. Nothing is ever lost to a missing callback.
    pub fn cancel_pending(ctx: Context<PlayerOnly>) -> Result<()> {
        let s = &mut ctx.accounts.session;
        require!(s.status == 1, ClawErr::NotPending);
        let now = Clock::get()?.unix_timestamp;
        require!(now - s.pending_ts >= VRF_TIMEOUT_SECS, ClawErr::TooEarly);
        let round = s.round.wrapping_sub(1);
        let idx = (round as usize) % RING;
        let ticket = MACHINES[s.ring[idx].machine as usize].ticket;
        s.pearls += ticket;
        s.paid = s.paid.saturating_sub(ticket);
        s.drops = s.drops.saturating_sub(1);
        s.ring[idx].outcome = OUT_VOID;
        s.status = 0;
        Ok(())
    }

    /// ER. Faucet: a broke player gets test pearls. Counted, never hidden.
    pub fn refill(ctx: Context<PlayerOnly>) -> Result<()> {
        let s = &mut ctx.accounts.session;
        require!(s.status == 0, ClawErr::Busy);
        require!(s.pearls < 5, ClawErr::NotBroke);
        s.pearls += START_PEARLS;
        s.refills = s.refills.saturating_add(1);
        Ok(())
    }

    /// ER. Close the permission, refunding rent to the session PDA.
    pub fn close_permission(ctx: Context<PermissionContext>) -> Result<()> {
        let signers = [
            SESSION_SEED,
            ctx.accounts.session.authority.as_ref(),
            &[ctx.bumps.session],
        ];
        CloseEphemeralPermissionCpi {
            payer: ctx.accounts.session.to_account_info(),
            permissioned_account: ctx.accounts.session.to_account_info(),
            permission: ctx.accounts.permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            authority: ctx.accounts.session.to_account_info(),
            authority_is_signer: false,
        }
        .invoke_signed(&[&signers])?;
        Ok(())
    }

    /// ER. Save progress to Solana without leaving the rollup.
    pub fn checkpoint(ctx: Context<UndelegateSession>) -> Result<()> {
        MagicIntentBundleBuilder::new(
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit(&[ctx.accounts.session.to_account_info()])
        .build_and_invoke()?;
        Ok(())
    }

    /// ER. Commit the final state to Solana and hand the account back.
    pub fn undelegate(ctx: Context<UndelegateSession>) -> Result<()> {
        MagicIntentBundleBuilder::new(
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit_and_undelegate(&[ctx.accounts.session.to_account_info()])
        .build_and_invoke()?;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init_if_needed,
        payer = authority,
        space = SESSION_SPACE,
        seeds = [SESSION_SEED, authority.key().as_ref()],
        bump
    )]
    pub session: Box<Account<'info, Session>>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[delegate]
#[derive(Accounts)]
pub struct DelegateSession<'info> {
    pub authority: Signer<'info>,
    /// CHECK: The session PDA to delegate
    #[account(mut, del, seeds = [SESSION_SEED, authority.key().as_ref()], bump)]
    pub session: UncheckedAccount<'info>,
    /// CHECK: Checked by the delegate program
    pub validator: Option<UncheckedAccount<'info>>,
}

/// Shared by init_permission / set_privacy / close_permission (all run on the ER).
#[derive(Accounts)]
pub struct PermissionContext<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [SESSION_SEED, session.authority.as_ref()],
        has_one = authority,
        bump
    )]
    pub session: Box<Account<'info, Session>>,
    /// CHECK: verified by permission program; seeds match the on-chain layout
    #[account(
        mut,
        seeds = [PERMISSION_SEED, session.key().as_ref()],
        bump,
        seeds::program = PERMISSION_PROGRAM_ID,
    )]
    pub permission: UncheckedAccount<'info>,
    /// CHECK: Permission Program
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: verified by magic program
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: Magic Program
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

#[vrf]
#[derive(Accounts)]
pub struct DropClaw<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        seeds = [SESSION_SEED, session.authority.as_ref()],
        constraint = session.authority == payer.key() @ ClawErr::NotYours,
        bump
    )]
    pub session: Box<Account<'info, Session>>,
    /// CHECK: verified by permission program; seeds match the on-chain layout
    #[account(
        mut,
        seeds = [PERMISSION_SEED, session.key().as_ref()],
        bump,
        seeds::program = PERMISSION_PROGRAM_ID,
    )]
    pub permission: UncheckedAccount<'info>,
    /// CHECK: Permission Program
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: verified by magic program
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: Magic Program
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
    /// CHECK: the oracle queue
    #[account(
        mut,
        constraint =
            oracle_queue.key() == vrf::consts::DEFAULT_QUEUE ||
            oracle_queue.key() == vrf::consts::DEFAULT_TEST_QUEUE ||
            oracle_queue.key() == vrf::consts::DEFAULT_EPHEMERAL_QUEUE ||
            oracle_queue.key() == vrf::consts::DEFAULT_EPHEMERAL_TEST_QUEUE
    )]
    pub oracle_queue: UncheckedAccount<'info>,
}

// Do NOT declare your own `vrf_program_identity`: the macro adds it, and skips
// its check if you do (VRF quickstart security note).
#[vrf_callback]
#[derive(Accounts)]
pub struct CallbackDrop<'info> {
    #[account(mut)]
    pub session: Box<Account<'info, Session>>,
}

#[derive(Accounts)]
pub struct PlayerOnly<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [SESSION_SEED, session.authority.as_ref()],
        has_one = authority,
        bump
    )]
    pub session: Box<Account<'info, Session>>,
}

#[commit]
#[derive(Accounts)]
pub struct UndelegateSession<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [SESSION_SEED, session.authority.as_ref()], bump)]
    pub session: Box<Account<'info, Session>>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct Receipt {
    pub round: u32,           // drop number; seeds the PUBLIC pit
    pub machine: u8,          // 0 Shell Shop, 1 Reef Run, 2 The Abyss
    pub x_pm: u16,            // where the claw dropped, permille of the cabinet width
    pub slot: u8,             // prize slot under the claw (255 = nothing in reach)
    pub kind: u8,             // prize kind in that slot
    pub centering: u16,       // permille, how centred the grab was
    pub chance: u16,          // hold chance in basis points, fixed BEFORE the roll
    pub outcome: u8,          // 0 pending, 1 miss, 2 slip, 3 hold, 4 void (refunded)
    pub roll: u16,            // 1..=10000 from the VRF bytes; hold iff roll <= chance
    pub randomness: [u8; 32], // the raw VRF output
}

#[account]
pub struct Session {
    pub authority: Pubkey,     // 32 the player
    pub pearls: u32,           // 4  test-pearl balance (a game score, not money)
    pub round: u32,            // 4  next drop number
    pub drops: u32,            // 4
    pub wins: u32,             // 4
    pub paid: u32,             // 4  tickets paid, in pearls
    pub won: u32,              // 4  prize value won, in pearls (paid/won give the real RTP)
    pub refills: u16,          // 2
    pub status: u8,            // 1  0 idle, 1 waiting for the VRF callback
    pub pending_ts: i64,       // 8
    pub ring: [Receipt; RING], // 8 x 48 = 384, newest at (round-1) % 8
    pub inventory: [u16; 5],   // 10 prizes owned by kind
}

#[error_code]
pub enum ClawErr {
    #[msg("unknown machine")]
    BadMachine,
    #[msg("aim must be 0..=1000")]
    BadAim,
    #[msg("a drop is already waiting for its roll")]
    Busy,
    #[msg("not enough pearls for the ticket")]
    Broke,
    #[msg("this is not your arcade account")]
    NotYours,
    #[msg("nothing is pending")]
    NotPending,
    #[msg("wait for the oracle timeout before cancelling")]
    TooEarly,
    #[msg("you still have pearls")]
    NotBroke,
}
