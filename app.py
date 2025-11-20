from flask import Flask, jsonify, request, render_template
import numpy as np
import pandas as pd
import os

app = Flask(__name__)

# --- Load main energy dataset ---
df_resampled = pd.read_csv('projectA_output.csv')

# --- Load cleaned station dataset (inside /static) ---
station_path = os.path.join('static', 'StationDetails_clean.csv')

try:
    station_df = pd.read_csv(station_path)
    # Ensure columns are standardized
    station_df.columns = station_df.columns.str.strip().str.lower()
    print(f"✅ Loaded {len(station_df)} clean station records.")
except Exception as e:
    print(f"⚠️ Error loading StationDetails_clean.csv: {e}")
    station_df = pd.DataFrame(columns=['county', 'station code', 'station name' 'latitude', 'longitude', 'open year'])

@app.route('/')
def index():
    return render_template('index.html')


@app.route('/data')
def data():
    """Main energy dataset endpoint"""
    return df_resampled.to_json(orient='records', date_format='iso')


@app.route('/stations')
def stations():
    expected_cols = ['county', 'station code', 'station name' , 'latitude', 'longitude', 'open year']
    df = station_df[expected_cols].copy()
    
    # Ensure numeric coordinates
    df['latitude'] = pd.to_numeric(df['latitude'], errors='coerce')
    df['longitude'] = pd.to_numeric(df['longitude'], errors='coerce')
    
    # Drop invalid rows
    df = df.dropna(subset=['latitude', 'longitude']).reset_index(drop=True)
    
    return df.to_json(orient='records')


@app.route('/simulate')
def simulate():
    storm_start = request.args.get('stormStart', '02:00')
    storm_end = request.args.get('stormEnd', '08:00')
    battery_cap = float(request.args.get('batteryCap', 5))

    df = df_resampled.copy()
    soc = battery_cap
    served = []
    soc_track = []
    district_supplies = []

    n_stations = len(station_df) or 5

    # Very slow fixed discharge per timestep (kWh)
    slow_discharge = 0.01

    for i, row in df.iterrows():
        t = pd.Timestamp(row['Datetime'])
        time_str = t.strftime('%H:%M')

        per_station = [0] * n_stations
        supply = 0

        if storm_start <= time_str <= storm_end and soc > 0:
            supply = min(slow_discharge, soc)
            per_station = [supply / n_stations] * n_stations
            soc -= supply
        else:
            # Slowly recharge
            soc = min(battery_cap, soc + 0.005)

        served.append(supply)
        soc_track.append(soc)
        district_supplies.append(per_station)

    # Add served load and SOC columns
    df['served_kW'] = served
    df['soc_kWh'] = soc_track

    # Build all station columns at once
    station_cols = {
        f'station_{idx+1}_kW': [x[idx] for x in district_supplies]
        for idx in range(n_stations)
    }
    station_df_new = pd.DataFrame(station_cols)

    # Concatenate to main df
    df = pd.concat([df, station_df_new], axis=1)

    return df.to_json(orient='records', date_format='iso')





if __name__ == '__main__':
    app.run(debug=True)
