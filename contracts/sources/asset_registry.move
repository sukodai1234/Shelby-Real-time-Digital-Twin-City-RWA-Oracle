module shelby_rwa::asset_registry {
    use std::signer;
    use std::vector;
    use aptos_framework::event;
    use aptos_framework::timestamp;
    use aptos_std::table::{Self, Table};

    const E_NOT_AUTHORIZED: u64 = 1;
    const E_ASSET_EXISTS: u64 = 2;
    const E_ASSET_NOT_FOUND: u64 = 3;
    const E_INVALID_SCORE: u64 = 4;
    const E_INVALID_RISK: u64 = 5;
    const E_INVALID_ASSET_ID: u64 = 6;
    const E_INVALID_DATA_HASH: u64 = 7;
    const E_INVALID_BLOB_NAME: u64 = 8;

    struct Registry has key { assets: Table<vector<u8>, Asset> }

    struct Asset has copy, drop, store {
        owner: address,
        oracle: address,
        shelby_account: address,
        livability_score: u64,
        structural_score: u64,
        risk_level: u8,
        data_hash: vector<u8>,
        blob_name: vector<u8>,
        updated_at: u64,
    }

    #[event]
    struct AssetRegistered has drop, store {
        asset_id: vector<u8>, owner: address, oracle: address, shelby_account: address,
    }

    #[event]
    struct ScoreUpdated has drop, store {
        asset_id: vector<u8>, owner: address, livability_score: u64,
        structural_score: u64, risk_level: u8, data_hash: vector<u8>,
        blob_name: vector<u8>, updated_at: u64,
    }

    fun init_module(module_signer: &signer) {
        move_to(module_signer, Registry { assets: table::new() });
    }

    public entry fun register_asset(owner: &signer, asset_id: vector<u8>, oracle: address, shelby_account: address) acquires Registry {
        assert!(!vector::is_empty(&asset_id), E_INVALID_ASSET_ID);
        let registry = borrow_global_mut<Registry>(@shelby_rwa);
        assert!(!table::contains(&registry.assets, copy asset_id), E_ASSET_EXISTS);
        let owner_address = signer::address_of(owner);
        table::add(&mut registry.assets, copy asset_id, Asset {
            owner: owner_address, oracle, shelby_account,
            livability_score: 100, structural_score: 100, risk_level: 0,
            data_hash: vector::empty(), blob_name: vector::empty(),
            updated_at: timestamp::now_seconds(),
        });
        event::emit(AssetRegistered { asset_id, owner: owner_address, oracle, shelby_account });
    }

    public entry fun rotate_oracle(owner: &signer, asset_id: vector<u8>, new_oracle: address) acquires Registry {
        let registry = borrow_global_mut<Registry>(@shelby_rwa);
        assert!(table::contains(&registry.assets, copy asset_id), E_ASSET_NOT_FOUND);
        let asset = table::borrow_mut(&mut registry.assets, asset_id);
        assert!(signer::address_of(owner) == asset.owner, E_NOT_AUTHORIZED);
        asset.oracle = new_oracle;
    }

    public entry fun update_score(
        oracle_signer: &signer, asset_id: vector<u8>, livability_score: u64,
        structural_score: u64, risk_level: u8, data_hash: vector<u8>, blob_name: vector<u8>,
    ) acquires Registry {
        assert!(livability_score <= 100 && structural_score <= 100, E_INVALID_SCORE);
        assert!(risk_level <= 3, E_INVALID_RISK);
        assert!(vector::length(&data_hash) == 32, E_INVALID_DATA_HASH);
        assert!(!vector::is_empty(&blob_name), E_INVALID_BLOB_NAME);
        let registry = borrow_global_mut<Registry>(@shelby_rwa);
        assert!(table::contains(&registry.assets, copy asset_id), E_ASSET_NOT_FOUND);
        let asset = table::borrow_mut(&mut registry.assets, copy asset_id);
        assert!(signer::address_of(oracle_signer) == asset.oracle, E_NOT_AUTHORIZED);
        asset.livability_score = livability_score;
        asset.structural_score = structural_score;
        asset.risk_level = risk_level;
        asset.data_hash = copy data_hash;
        asset.blob_name = copy blob_name;
        asset.updated_at = timestamp::now_seconds();
        event::emit(ScoreUpdated {
            asset_id, owner: asset.owner, livability_score, structural_score,
            risk_level, data_hash, blob_name, updated_at: asset.updated_at,
        });
    }

    #[view]
    public fun asset_exists(asset_id: vector<u8>): bool acquires Registry {
        table::contains(&borrow_global<Registry>(@shelby_rwa).assets, asset_id)
    }

    #[view]
    public fun get_asset(asset_id: vector<u8>): Asset acquires Registry {
        let registry = borrow_global<Registry>(@shelby_rwa);
        assert!(table::contains(&registry.assets, copy asset_id), E_ASSET_NOT_FOUND);
        *table::borrow(&registry.assets, asset_id)
    }

    #[test(aptos_framework = @aptos_framework, module_signer = @shelby_rwa, owner = @0x123, oracle = @0x456)]
    fun test_register_and_update(aptos_framework: &signer, module_signer: &signer, owner: &signer, oracle: &signer) acquires Registry {
        timestamp::set_time_has_started_for_testing(aptos_framework);
        init_module(module_signer);
        let asset_id = b"coastal-home-001";
        register_asset(owner, copy asset_id, signer::address_of(oracle), @0x789);
        assert!(asset_exists(copy asset_id), 100);
        update_score(
            oracle,
            copy asset_id,
            82,
            76,
            1,
            vector[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                   0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            b"digital-twins/coastal-home-001/snapshot.json",
        );
        let asset = get_asset(asset_id);
        assert!(asset.livability_score == 82, 101);
        assert!(asset.structural_score == 76, 102);
        assert!(asset.risk_level == 1, 103);
    }
}
