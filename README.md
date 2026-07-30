Explanation of the code logic:

Layer 1 (Data Ingestion): The variable self.local_data represents the Oracles "feeding" real-world local data into the system.

Layer 2 (AI Engine): The ai_predict_degradation function uses environmental parameters (salinity) to predict the future of the house. This is the Time-Travel Simulation feature.

Layer 3 (RWA & Smart Contract): The calculate_livability_score function transforms raw data into an economically valuable number (for on-chain real estate valuation).

The reactive_smart_contract function represents automation: you don't need to monitor prices; the system will automatically execute when the "Oracle" conditions (price, environment) match.

Would you like me to further develop the integration of a real-world API (e.g., retrieving real-world weather data from OpenWeather) to make this simulation more realistic?

New features in this code:
Oxygen & Fine Dust Data: The system can now recognize vital signs. If oxygen levels decrease (due to heavy pollution or high building density), the Livability Score will plummet rapidly (20x penalty).

Salinity Logic: I've added the structural_health_forecast function. This is crucial for coastal areas or near industrial zones, helping you choose the right materials right from the codebase stage.

Real-time Streaming: The for loop simulates Shelby's continuous data recording every second, something Aptos/Shelby handles very smoothly thanks to its parallel processing mechanism.
