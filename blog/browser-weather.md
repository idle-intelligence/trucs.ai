---
layout: default
title: "Browser weather"
description: "Weather data straight from your browser, no server, using the kNN weather modules from trucs.ai/knn-weather."
---

# Browser weather

Do you feel like the weather models aren't very good at predicting temperature near you? That's because in most cases their closest data points are the airports, far from you.

Airports report the weather every half hour or so, in a short coded format called METAR: temperature, dew point, wind, pressure, visibility, clouds. A report looks like `LFPG 231200Z 24012KT 9999 SCT030 18/11 Q1015`. These reports are public, and some services serve them in a way a web page can read directly: the [Iowa Environmental Mesonet](https://mesonet.agron.iastate.edu/) for the whole world, the [US National Weather Service](https://www.weather.gov/documentation/services-web-api) for the US. Everything below is fetched and computed by your browser, no server of mine in between.

Pick a place:

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

So we have weather station data. As you can probably see, most of the stations are far away from you.

One very naïve thing we can do, if we want to know the temperature where we are, is to average those values.

<div class="output-line">
  <span class="output-label">plain average</span>
  <span class="output-value" id="bw-plain-mean-value"></span>
</div>

A simple improvement we can make is to take into account how far the stations are. The stations close to you should count more than the ones far away, so we weight each one by the inverse of its distance: a station twice as far counts half as much.

<div id="bw-theory-app">
  <canvas id="bw-theory-chart"></canvas>
  <p class="bw-caption">weight = 1 / distance (km)</p>
</div>

The far ones barely count: a station 50 km away weighs a tenth of one 5 km away. So there is no point in fetching many of them. We take the 5 nearest within 100 km, which also keeps the data small.

<p id="bw-stations-used-line">Here are the 5 stations used for your place, and the share of the total each one gets:</p>

<div id="bw-weight-app">
  <canvas id="bw-weight-chart"></canvas>
  <p id="bw-weight-caption" class="bw-caption"></p>
</div>

<pre id="bw-weighted-eq" class="bw-equation"></pre>

We get a first estimation, and it costs us <span id="bw-first-ms"></span> ms.

<div class="output-line">
  <span class="output-label">temperature</span>
  <span class="output-value" id="bw-first-estimate-value"></span>
</div>

Now, we only take into account the distance, but other things factor in. Say you live at the top of a mountain and there's an airport down in the valley, just a few kilometers away. You probably have pretty different temperatures, even though you're not that far away.

So we correct for a few things. Temperature drops with altitude, so each station's temperature is brought to the altitude of your point, using the temperature gradient measured across the stations themselves, or the textbook 6.5 °C per kilometer when there aren't enough stations to measure it. Dew point doesn't average well as it is, so we average the water vapor pressure instead and convert back. Pressure is averaged as the sea-level value the airports report, then brought down or up to your altitude. Wind is averaged as direction and strength together, so a north wind and a south wind cancel out instead of averaging to an east wind. It's a simplified cousin of GIDS (Gradient plus Inverse Distance Squared), a method used to interpolate climate data between stations: plain inverse distance, and only the altitude gradient.

<pre id="bw-final-eq" class="bw-equation"></pre>

<div id="bw-output-panel"></div>

This is still a naive approach. Weather services use far more precise methods: physical models of the atmosphere, radar, satellites, and statistical methods that learn how stations relate to each other. But this one needs a handful of reports and a fraction of a millisecond, and it runs entirely in your browser.

If you want to go further, here are three methods that climatologists use to fill the gaps between stations:

- **GIDS** (Gradient plus Inverse Distance Squared, Nalder and Wein, 1998). A slightly more complex version of what we do here. It fits how temperature changes with longitude, latitude and altitude across the nearby stations, then weights them by the square of their distance. Still cheap in data and compute: a few stations and a small regression per point.
- **Thin-plate smoothing splines** (Hutchinson's ANUSPLIN, used for the WorldClim climate maps). It fits one smooth surface through all the stations at once, with altitude as an extra dimension, and chooses how smooth by cross-validation. Smoother and better grounded statistically. But it needs every station at once: the exact fit solves one system as large as the number of stations, fine on a computer once per update, heavy in a phone's browser. It also smooths away local effects.
- **PRISM** (Parameter-elevation Regressions on Independent Slopes Model, Daly and colleagues, Oregon State University). It fits a temperature-versus-altitude relation for every map cell, weighting stations by distance, altitude, which side of the mountain they're on, and distance to the coast. The most accurate in mountains, and behind the official US climate maps. But it needs a detailed elevation model and a lot of expert tuning, and it's built for long-term averages, not the weather right now.

Weather models are fed with data from these same stations, then compute an approximate value for your location. A somewhat naive approach, that runs instantly in your browser, can be pretty close to the actual weather _now_.

<p class="panel-desc">
  Reuses the kNN, IDW, correction and source-fetching modules from <a href="/knn-weather/">/knn-weather/</a>. Stations: <a href="http://www.rap.ucar.edu/weather/surface/stations.txt">NCAR/RAP stations.txt</a> (Greg Thompson, NCAR/RAP). Observations: <a href="https://mesonet.agron.iastate.edu/">Iowa Environmental Mesonet</a>, <a href="https://www.weather.gov/documentation/services-web-api">api.weather.gov</a>; elevation from <a href="https://open-meteo.com/">Open-Meteo</a>.
</p>

<style>
  #bw-app, #bw-theory-app, #bw-weight-app { margin: 1.25em 0; }
  #bw-app button {
    font-family: inherit;
    font-size: 1rem;
    padding: 0.5em 1.5em;
    border: 1px solid #111;
    background: #fff;
    color: #111;
    cursor: pointer;
    border-radius: 2px;
  }
  #bw-app button:hover:not(:disabled) { background: #111; color: #fff; }
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
  .bw-no-report { color: #999; }
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
  #bw-theory-chart, #bw-weight-chart {
    display: block;
    width: 100%;
    height: 220px;
    border: 1px solid #ddd;
    background: #fff;
  }
  .bw-caption {
    font-family: "Courier New", Courier, monospace;
    font-size: 0.75rem;
    line-height: 1.3;
    color: #555;
    margin-top: 0.35em;
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
-->
