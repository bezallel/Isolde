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
    """
    Serve only the essential columns and a limited rolling window
    to reduce payload size and prevent browser crashes.
    """
    essential_cols = ['Datetime', 'load_kW', 'shifted_load_kW', 'served_kW', 'soc_kWh']
    
    # Only keep last 500 rows (matches MAX_POINTS in frontend)
    df_small = df_resampled[essential_cols].tail(500)
    
    return df_small.to_json(orient='records', date_format='iso')
    

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
    window_size = 500  # keep the output manageable

    df = df_resampled.copy()
    soc = battery_cap
    served = []
    soc_track = []

    for _, row in df.iterrows():
        t = pd.Timestamp(row['Datetime'])
        time_str = t.strftime('%H:%M')

        # Very slow fixed discharge
        if storm_start <= time_str <= storm_end and soc > 0:
            supply = min(0.01, soc)
            soc -= supply
            served.append(supply)
        else:
            soc = min(battery_cap, soc + 0.005)
            served.append(0)
        soc_track.append(soc)

    df['served_kW'] = served
    df['soc_kWh'] = soc_track

    # Keep only essential columns + rolling window
    essential_cols = ['Datetime', 'load_kW', 'shifted_load_kW', 'served_kW', 'soc_kWh']
    df_small = df[essential_cols].tail(window_size)

    return df_small.to_json(orient='records', date_format='iso')





if __name__ == '__main__':
    app.run(debug=True)
