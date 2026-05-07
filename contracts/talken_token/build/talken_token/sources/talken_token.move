/// TALKEN Token — native token for the TALKEN Agent compute network.
///
/// Functions:
/// - mint: create new tokens (admin only)
/// - slash: destroy tokens from an address (admin only)
/// - transfer: send tokens between addresses
/// - balance_of: query balance
module talken_token::talken_token {
    use iota::coin::{Self, TreasuryCap, Coin};
    use iota::event;

    /// The OTW (one-time witness) for creating the currency.
    public struct TALKEN_TOKEN has drop {}

    /// Admin capability — granted to deployer on init.
    public struct AdminCap has key, store {
        id: UID,
    }

    /// Event emitted on mint.
    public struct MintEvent has copy, drop {
        to: address,
        amount: u64,
    }

    /// Event emitted on slash.
    public struct SlashEvent has copy, drop {
        from: address,
        amount: u64,
    }

    /// Event emitted on transfer.
    public struct TransferEvent has copy, drop {
        from: address,
        to: address,
        amount: u64,
    }

    /// Module initializer — creates the TALKEN currency and transfers
    /// the TreasuryCap and AdminCap to the deployer.
    fun init(witness: TALKEN_TOKEN, ctx: &mut TxContext) {
        let (treasury, metadata) = coin::create_currency(
            witness,
            9,                              // 9 decimals
            b"TALKEN",                      // symbol
            b"TALKEN Token",                // name
            b"Native token for TALKEN",     // description
            option::none(),                 // icon url
            ctx,
        );
        // Freeze metadata so nobody can change it
        transfer::public_freeze_object(metadata);
        // Transfer treasury cap to deployer
        transfer::public_transfer(treasury, ctx.sender());
        // Grant admin cap to deployer
        transfer::transfer(
            AdminCap { id: object::new(ctx) },
            ctx.sender(),
        );
    }

    // ── Public functions ────────────────────────────────────────────────

    /// Mint new TALKEN tokens. Only the holder of AdminCap can call this.
    public fun mint(
        _cap: &AdminCap,
        treasury: &mut TreasuryCap<TALKEN_TOKEN>,
        to: address,
        amount: u64,
        ctx: &mut TxContext,
    ) {
        let coin = coin::mint(treasury, amount, ctx);
        transfer::public_transfer(coin, to);
        event::emit(MintEvent { to, amount });
    }

    /// Slash (burn) tokens from an address. The caller must have AdminCap
    /// and the target must provide a Coin to burn.
    /// In practice, the settlement service will collect the Coin from the
    /// validator's balance first, then pass it here.
    public fun slash(
        _cap: &AdminCap,
        treasury: &mut TreasuryCap<TALKEN_TOKEN>,
        from: Coin<TALKEN_TOKEN>,
        amount: u64,
    ) {
        assert!(coin::value(&from) >= amount, 1); // EINSUFFICIENT
        // Burn the specified amount
        coin::burn(treasury, from);
        event::emit(SlashEvent { from: @0x0, amount }); // from is implicit
    }

    /// Transfer TALKEN tokens between addresses. Anyone can call this.
    public fun transfer_tokens(
        coin: Coin<TALKEN_TOKEN>,
        to: address,
        ctx: &mut TxContext,
    ) {
        let amount = coin::value(&coin);
        transfer::public_transfer(coin, to);
        event::emit(TransferEvent {
            from: ctx.sender(),
            to,
            amount,
        });
    }

    /// Convenience: split coins and transfer a specific amount.
    public fun split_and_transfer(
        coin: &mut Coin<TALKEN_TOKEN>,
        amount: u64,
        to: address,
        ctx: &mut TxContext,
    ) {
        let split = coin::split(coin, amount, ctx);
        transfer::public_transfer(split, to);
        event::emit(TransferEvent {
            from: ctx.sender(),
            to,
            amount,
        });
    }

    /// Burn a coin entirely.
    public fun burn(
        treasury: &mut TreasuryCap<TALKEN_TOKEN>,
        coin: Coin<TALKEN_TOKEN>,
    ) {
        coin::burn(treasury, coin);
    }
}
