---
layout: default
title: "Browser weather"
description: "Weather data straight from your browser, no server, using the kNN weather modules from trucs.ai/knn-weather."
---

# Browser weather

Did you know you can get weather data directly from your browser?

<!-- DRAFT (Claude, for TC to rewrite): what METAR is and who publishes it.
METAR (METeorological Aerodrome Report) is the standard format for
routine surface weather observations, reported roughly every 30 to 60
minutes at airports and a smaller number of non-aviation sites worldwide.
Each report gives temperature, dew point, wind, pressure (as an altimeter
setting, QNH), visibility and cloud cover as short coded groups, e.g.
`METAR LFPG 231200Z 24012KT 9999 SCT030 18/11 Q1015`.
This page uses two live sources of decoded METAR data:
- the Iowa Environmental Mesonet (IEM) `currents.json` API, a public
  archive and real-time feed of ASOS/METAR observations run by Iowa
  State University: https://mesonet.agron.iastate.edu/
- api.weather.gov, the US National Weather Service's public API, used
  for US stations because it is fresher than IEM's feed:
  https://www.weather.gov/documentation/services-web-api
The station list itself (about 8,100 ICAO stations worldwide, with
name and elevation) comes from NCAR/RAP's `stations.txt`, maintained by
Greg Thompson: http://www.rap.ucar.edu/weather/surface/stations.txt
Elevation for the point you pick (not a station) comes from Open-Meteo:
https://open-meteo.com/
-->

Do you feel like the weather models aren't very good at predicting temperature near you? That's because in most cases their closest data points are the airports, far from you.

<div id="bw-app">
  <div class="series-grid" id="bw-city-grid"></div>
  <div class="bw-input-row">
    <button id="bw-geo-btn" type="button">use my location</button>
    <input type="text" id="bw-loc-input" placeholder="lat, lon" aria-label="location">
  </div>
  <p id="bw-status-text" class="bw-status">choose a location</p>

  <p id="bw-count-line"></p>

  <div id="bw-table-wrap"></div>

  <div id="bw-output-panel"></div>
  <pre id="bw-equation-block" class="bw-equation"></pre>
</div>

Models are trained using data from these stations, and then they compute an approached value based on your geolocation.

A somewhat naive approach, that runs instantly in your browser, can be pretty close to the actual weather _now_.

We show the inference results, explain the calculation method, with the actual data (the kNN weighted average equation, the correction, etc).

<!-- DRAFT (Claude, for TC to rewrite): the calculation method in general terms.
Each station gets a weight equal to the inverse of its distance to the
target point, w_i = 1 / d_i (this is the "distance" weighting of
scikit-learn's KNeighborsRegressor, ported from SenseAI's original
Python model). The estimate is the weighted average sum(v_i * w_i) /
sum(w_i). Temperature is then reduced from each station's own elevation
to the target point's elevation using a lapse rate fitted by least
squares across the neighbours (falling back to the standard atmosphere,
-6.5 K/km, when there are fewer than 3 usable stations or the fit is
implausible). Dew point is averaged as vapour pressure (Magnus formula)
rather than directly, because dew point itself does not average
linearly. Pressure is averaged as the altimeter setting (QNH), then
reduced to station pressure at the target elevation. Wind is averaged
as its (u, v) vector components, not as scalar speed and direction.
Method after Nalder & Wein (1998); worked out at SenseAI (2015), where
TC was CTO.
-->

We can also show that using more stations doesn't help much, by plotting temperature as a function of number of stations used (1 to 23).

We can do the same for each measurement value.

<div id="bw-app-2">
  <div class="series-grid" id="bw-metric-grid"></div>
  <canvas id="bw-chart"></canvas>
  <p id="bw-chart-caption" class="panel-desc"></p>
</div>

<p class="panel-desc">
  Reuses the kNN, IDW, correction and source-fetching modules from <a href="/knn-weather/">/knn-weather/</a>. Stations: <a href="http://www.rap.ucar.edu/weather/surface/stations.txt">NCAR/RAP stations.txt</a> (Greg Thompson, NCAR/RAP). Observations: <a href="https://mesonet.agron.iastate.edu/">Iowa Environmental Mesonet</a>, <a href="https://www.weather.gov/documentation/services-web-api">api.weather.gov</a>; elevation from <a href="https://open-meteo.com/">Open-Meteo</a>.
</p>

<style>
  #bw-app, #bw-app-2 { margin: 1.25em 0; }
  #bw-app button, #bw-app-2 button {
    font-family: inherit;
    font-size: 1rem;
    padding: 0.5em 1.5em;
    border: 1px solid #111;
    background: #fff;
    color: #111;
    cursor: pointer;
    border-radius: 2px;
  }
  #bw-app button:hover:not(:disabled), #bw-app-2 button:hover:not(:disabled) { background: #111; color: #fff; }
  .series-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5em;
    margin: 0.75em 0;
  }
  .series-btn {
    font-family: inherit;
    font-size: 0.85rem;
    padding: 0.35em 0.9em;
    cursor: pointer;
    border: 1px solid #111;
    background: #fff;
    color: #111;
    border-radius: 2px;
    text-align: center;
    line-height: 1.3;
  }
  .series-btn:hover:not(:disabled) { background: #111; color: #fff; }
  .series-btn.active { background: #111; color: #fff; }
  .bw-input-row {
    margin: 0.75em 0;
    display: flex;
    align-items: center;
    gap: 0.75em;
    flex-wrap: wrap;
  }
  #bw-app input[type="text"] {
    font-family: inherit;
    font-size: 1rem;
    padding: 0.4em 0.5em;
    border: 1px solid #ddd;
    background: #fff;
    color: #111;
    border-radius: 2px;
    width: 14em;
    max-width: 100%;
  }
  #bw-app input[type="text"]:focus { outline: none; border-color: #111; }
  .bw-status { color: #555; font-size: 0.85rem; }
  #bw-count-line { font-size: 0.9rem; }
  .bw-table {
    border-collapse: collapse;
    width: 100%;
    font-size: 0.8rem;
    margin: 0.75em 0;
  }
  .bw-table th, .bw-table td {
    border: 1px solid #ddd;
    padding: 0.3em 0.5em;
    text-align: left;
  }
  .bw-table th { color: #555; font-weight: normal; }
  .output-line { margin: 0.6em 0; }
  .output-label { display: inline-block; width: 7.5em; color: #555; }
  .output-value { font-size: 1.1rem; font-weight: bold; color: #111; }
  .bw-equation {
    font-family: inherit;
    font-size: 0.8rem;
    color: #555;
    white-space: pre-wrap;
    margin: 0.75em 0;
  }
  #bw-chart {
    display: block;
    width: 100%;
    height: 220px;
    border: 1px solid #ddd;
    background: #fff;
  }
</style>

<script type="module" src="/blog/browser-weather/app.js"></script>

<!--
PROPOSALS (Claude, for TC to accept or drop; none of this is in the visible post):
- Compare the estimate against a model forecast (Open-Meteo's gridded value for the same point and hour) to show where the naive kNN and a real model agree or diverge.
- Show the distance to the nearest airport station as its own fact, since that's the number the intro paragraph is really about.
- Add uncertainty from station spread (the standard deviation already computed in corrections.js) next to each estimate.
- Add a note on typical METAR latency (age of the freshest station used) since it changes how "now" the estimate really is.
- Replace manual city buttons with a click-anywhere map once the map experiment is ready.
- Let the k sweep run per-city side by side, to show the curve flattens at different k depending on station density.
-->
