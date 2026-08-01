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
    const E_INVALID_COORDINATE: u64 = 9;
    const E_INVALID_HUMIDITY: u64 = 10;
    const E_INVALID_ENVIRONMENT_RISK: u64 = 11;
    const E_INVALID_AQI: u64 = 12;

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
        latitude_offset_e6: u64,
        longitude_offset_e6: u64,
        humidity_pct_x100: u64,
        precipitation_mm_h_x100: u64,
        aqi: u64,
        environment_risk_index: u8,
        biosensory_risk_index: u8,
        location_fit_score: u8,
        environment_data_hash: vector<u8>,
        environment_blob_name: vector<u8>,
        environment_updated_at: u64,
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

    #[event]
    struct EnvironmentUpdated has drop, store {
        asset_id: vector<u8>,
        owner: address,
        latitude_offset_e6: u64,
        longitude_offset_e6: u64,
        humidity_pct_x100: u64,
        precipitation_mm_h_x100: u64,
        aqi: u64,
        environment_risk_index: u8,
        biosensory_risk_index: u8,
        location_fit_score: u8,
        data_hash: vector<u8>,
        blob_name: vector<u8>,
        updated_at: u64,
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
            latitude_offset_e6: 0, longitude_offset_e6: 0,
            humidity_pct_x100: 0, precipitation_mm_h_x100: 0, aqi: 0,
            environment_risk_index: 0,
            biosensory_risk_index: 0, location_fit_score: 0,
            environment_data_hash: vector::empty(), environment_blob_name: vector::empty(),
            environment_updated_at: 0,
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

    /// Stores a verifiable environmental snapshot for this digital-twin asset.
    /// Coordinates are offset fixed-point values because this Move package uses unsigned integers:
    /// latitude_offset_e6 = (latitude + 90) * 1e6 and
    /// longitude_offset_e6 = (longitude + 180) * 1e6.
    public entry fun update_environment(
        oracle_signer: &signer,
        asset_id: vector<u8>,
        latitude_offset_e6: u64,
        longitude_offset_e6: u64,
        humidity_pct_x100: u64,
        precipitation_mm_h_x100: u64,
        aqi: u64,
        environment_risk_index: u8,
        biosensory_risk_index: u8,
        location_fit_score: u8,
        data_hash: vector<u8>,
        blob_name: vector<u8>,
    ) acquires Registry {
        assert!(latitude_offset_e6 <= 180000000, E_INVALID_COORDINATE);
        assert!(longitude_offset_e6 <= 360000000, E_INVALID_COORDINATE);
        assert!(humidity_pct_x100 <= 10000, E_INVALID_HUMIDITY);
        assert!(aqi <= 1000, E_INVALID_AQI);
        assert!(environment_risk_index >= 1 && environment_risk_index <= 100, E_INVALID_ENVIRONMENT_RISK);
        assert!(biosensory_risk_index >= 1 && biosensory_risk_index <= 100, E_INVALID_ENVIRONMENT_RISK);
        assert!(location_fit_score >= 1 && location_fit_score <= 100, E_INVALID_ENVIRONMENT_RISK);
        assert!(vector::length(&data_hash) == 32, E_INVALID_DATA_HASH);
        assert!(!vector::is_empty(&blob_name), E_INVALID_BLOB_NAME);
        let registry = borrow_global_mut<Registry>(@shelby_rwa);
        assert!(table::contains(&registry.assets, copy asset_id), E_ASSET_NOT_FOUND);
        let asset = table::borrow_mut(&mut registry.assets, copy asset_id);
        assert!(signer::address_of(oracle_signer) == asset.oracle, E_NOT_AUTHORIZED);
        asset.latitude_offset_e6 = latitude_offset_e6;
        asset.longitude_offset_e6 = longitude_offset_e6;
        asset.humidity_pct_x100 = humidity_pct_x100;
        asset.precipitation_mm_h_x100 = precipitation_mm_h_x100;
        asset.aqi = aqi;
        asset.environment_risk_index = environment_risk_index;
        asset.biosensory_risk_index = biosensory_risk_index;
        asset.location_fit_score = location_fit_score;
        asset.environment_data_hash = copy data_hash;
        asset.environment_blob_name = copy blob_name;
        asset.environment_updated_at = timestamp::now_seconds();
        event::emit(EnvironmentUpdated {
            asset_id,
            owner: asset.owner,
            latitude_offset_e6,
            longitude_offset_e6,
            humidity_pct_x100,
            precipitation_mm_h_x100,
            aqi,
            environment_risk_index,
            biosensory_risk_index,
            location_fit_score,
            data_hash,
            blob_name,
            updated_at: asset.environment_updated_at,
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
        update_environment(
            oracle,
            copy asset_id,
            100823100,
            286629700,
            8600,
            300,
            90,
            36,
            53,
            76,
            vector[1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
                   1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
            b"environment/coastal-home-001/2026-08-01T19:00.json",
        );
        let asset = get_asset(asset_id);
        assert!(asset.livability_score == 82, 101);
        assert!(asset.structural_score == 76, 102);
        assert!(asset.risk_level == 1, 103);
        assert!(asset.latitude_offset_e6 == 100823100, 104);
        assert!(asset.longitude_offset_e6 == 286629700, 105);
        assert!(asset.environment_risk_index == 36, 106);
        assert!(asset.aqi == 90, 107);
        assert!(asset.biosensory_risk_index == 53, 108);
        assert!(asset.location_fit_score == 76, 109);
    }
}
