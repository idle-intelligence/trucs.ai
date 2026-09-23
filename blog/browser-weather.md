---
layout: default
title: "Browser weather"
description: "Weather data straight from your browser, no server, using the kNN weather modules from trucs.ai/knn-weather."
---

# Browser weather

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
</div>

ok we've got weather stations data, as you can probably see, they are mostly far away from you.

One very naïve thing we can do, for example if we want to know what's the temperature where we are, is more or less average those values.

<div class="output-line">
  <span class="output-label">plain average</span>
  <span class="output-value" id="bw-plain-mean-value"></span>
</div>

Of course we don't average like that.

<!-- DRAFT (Claude, for TC to rewrite): the kNN distance-weighted average as the
code computes it. Each of the k nearest stations within 100 km gets a weight
equal to the inverse of its distance to the target point, w_i = 1 / d_i (this
is the "distance" weighting of scikit-learn's KNeighborsRegressor, ported
from SenseAI's original Python model). The estimate is the weighted average
sum(v_i * w_i) / sum(w_i), so a station twice as far counts half as much. -->

<pre id="bw-weighted-eq" class="bw-equation"></pre>

We get a first estimation, and it costs us <span id="bw-first-ms"></span>ms.

<div class="output-line">
  <span class="output-label">temperature</span>
  <span class="output-value" id="bw-first-estimate-value"></span>
</div>

Now, we only take into account the distance, but other things factor in. Say you live at the top of a mountain and there's an airport down in the valley, just a few kilometers away. You probably have pretty different temperatures, even though you're not that far away.

<!-- DRAFT (Claude, for TC to rewrite): the corrections the code applies on
top of the plain distance-weighted average, after Nalder & Wein (1998).
Temperature is reduced from each station's own elevation to the target
point's elevation using a lapse rate fitted by least squares across the
neighbours (falling back to the standard atmosphere, -6.5 K/km, when there
are fewer than 3 usable stations or the fit is implausible). Dew point is
averaged as vapour pressure (Magnus formula) rather than directly, because
dew point itself does not average linearly. Pressure is averaged as the
altimeter setting (QNH), then reduced to station pressure at the target
elevation. Wind is averaged as its (u, v) vector components, not as scalar
speed and direction. Worked out at SenseAI (2015), where TC was CTO. -->

<pre id="bw-final-eq" class="bw-equation"></pre>

<div id="bw-output-panel"></div>

<!-- DRAFT (Claude, for TC to rewrite): why adding more stations barely moves
the estimate. Because each station's weight is 1 / distance, a station's
share of the total falls off quickly as it gets farther away: doubling the
distance halves the weight. Past the handful of closest stations, each
additional one contributes a small enough share that including or excluding
it changes the estimate by very little. That's what the chart below shows:
the grey curve is the theoretical 1/distance share for this run's station
set, and the dots are the actual stations, sitting on that curve at their
own distance. -->

<div id="bw-weight-app">
  <canvas id="bw-weight-chart"></canvas>
  <p id="bw-weight-caption" class="panel-desc"></p>
</div>

Models are trained using data from these stations, and then they compute an approached value based on your geolocation.

A somewhat naive approach, that runs instantly in your browser, can be pretty close to the actual weather _now_.

We show the inference results, explain the calculation method, with the actual data (the kNN weighted average equation, the correction, etc...)

<!-- DRAFT (Claude, for TC to rewrite): the calculation method in general terms.
Each station gets a weight equal to the inverse of its distance to the
target point, w_i = 1 / d_i (this is the "distance" weighting of
scikit-learn's KNeighborsRegressor, ported from SenseAI's original
Python model). The estimate is the weighted average sum(v_i * w_i) /
sum(w_i). Temperature is then reduced from each station's own elevation
to the target point's elevation using a lapse rate fitted by least
squares across the neighbours (falls back to the standard atmosphere,
-6.5 K/km, if fewer than 3 stations or an implausible fit). Dew point is
averaged as vapour pressure (Magnus formula), then converted back, since
dew point itself is not a linearly averageable quantity. Pressure is
averaged as the altimeter setting (QNH), then reduced to station pressure
at the target elevation. Wind is averaged as vector components (u, v),
not scalar speed and direction. Method after Nalder & Wein (1998); worked
out at SenseAI (2015), where TC was CTO.
-->

We can also show that using more stations doesn't help much, by plotting temperature as a function of number of stations used (1 -> 23)

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
  #bw-app, #bw-app-2, #bw-weight-app { margin: 1.25em 0; }
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
  #bw-chart, #bw-weight-chart {
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
