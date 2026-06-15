---
layout: layouts/page.njk
title: Economy Lab — US & UK economic analysis · danbot lab
description: "An interactive dashboard for analyzing the US and UK economies: GDP and growth, government spending and revenue, the tax mix, who pays income tax across income percentiles, and wealth distribution by class — built on credible government data (OMB, CBO, IRS, the Federal Reserve, OBR, HMRC and the ONS)."
templateEngineOverride: md
extraCss:
  - /blogs/economy/economy.css
scripts:
  - src: /blogs/economy/dashboard.js
    module: true
---
# Economy Lab — US & UK

> A system for graphing credible government data to reason about economic growth, the size of the state, tax policy and inequality.

This dashboard pulls together public data from official sources — the US Office of Management and Budget, the Congressional Budget Office, the IRS, the Federal Reserve, the UK Office for Budget Responsibility, HM Revenue & Customs and the Office for National Statistics — and lets you compare the United States and the United Kingdom across the questions that actually drive economic arguments.

Every chart is interactive: **hover** for exact figures, **click legend entries** to isolate a series, and use the toggles to switch country, units, or view. Each panel links its underlying source.

<div id="headline-stats" class="econ-stats"></div>

## Economic growth

How big are these economies, how much output is there per person, and how fast are they actually growing once you strip out inflation? Toggle between the level of GDP, GDP per capita, and the year-on-year real growth rate.

<div id="view-growth" class="econ-section"></div>

## Government spending & revenue

The two lines that define fiscal policy: what the government **spends** and what it **takes in**. The gap between them is the deficit (or, rarely, the surplus). Switch to *% of GDP* to compare the size of the state across two economies of very different scale — and notice how both countries' spending spiked during the 2008 crisis and again in 2020.

<div id="view-spending" class="econ-section"></div>

## Where the money comes from

Almost all government revenue is tax. But *which* taxes? This view breaks revenue into its components over time — individual income tax, payroll / National Insurance, corporate tax, VAT or excise, capital gains and the rest. Switch to **Share %** to see the proportions, and note how heavily both states lean on taxing ordinary incomes and consumption rather than capital.

<div id="view-revenue-sources" class="econ-section"></div>

## Who pays income tax

Income tax is steeply progressive in both countries: a small slice of high earners pays a large share of the total. The bars show the share of income tax paid by each top group; for the US you can also see the **average effective federal tax rate** by income quintile (it climbs from near zero at the bottom to ~30% for the top 1%), and for the UK how the top 1%'s share has risen over time.

<div id="view-income-tax" class="econ-section"></div>

## Wealth distribution by class

Income is what you earn in a year; wealth is what you've accumulated. Wealth is far more concentrated than income. This view stacks the share of total household wealth held by each class. In the US the top 1% alone hold roughly 30% of all wealth while the bottom half hold around 2–3%. The UK looks less concentrated — partly real, partly because the ONS measure folds in pensions and housing.

<div id="view-wealth" class="econ-section"></div>

## Government balance sheet

Deficits accumulate. Debt as a share of GDP is the running tally of every past year's borrowing, and it is the number that ultimately constrains tax-and-spend choices. Both countries crossed from ~35–40% of GDP before 2008 to roughly 100% today.

<div id="view-balance" class="econ-section"></div>

<details class="econ-method">
<summary>Sources & methodology</summary>
<ul>
<li><strong>GDP &amp; population</strong> are pulled from the <a href="https://data.worldbank.org" target="_blank" rel="noopener">World Bank</a> open data (current-US$ GDP and total population); GDP per capita is computed from the two. Real growth rates are compiled from US BEA and UK ONS national accounts.</li>
<li><strong>US federal finances</strong> (spending, revenue, revenue by source, debt held by the public) come from the <a href="https://www.whitehouse.gov/omb/budget/historical-tables/" target="_blank" rel="noopener">OMB Historical Tables</a> and <a href="https://www.cbo.gov" target="_blank" rel="noopener">CBO</a>, fiscal years, in US$ billions. "Other" receipts (customs, estate &amp; gift, miscellaneous) are derived as the residual so components sum to the published total.</li>
<li><strong>UK public finances</strong> come from the <a href="https://obr.uk/data/" target="_blank" rel="noopener">OBR Public Finances Databank</a>, <a href="https://www.gov.uk/government/statistics/hmrc-tax-and-nics-receipts-for-the-uk" target="_blank" rel="noopener">HMRC receipts</a> and the <a href="https://www.ons.gov.uk/economy/governmentpublicsectorandtaxes/publicsectorfinance" target="_blank" rel="noopener">ONS</a>, financial years, in £ billions.</li>
<li><strong>Tax distribution.</strong> US shares of federal individual income tax are IRS Statistics of Income (tax year 2022, via the Tax Foundation); effective rates are CBO average total federal tax rates by income quintile. UK shares are <a href="https://www.gov.uk/government/statistics/income-tax-liabilities-statistics-tax-year-2022-to-2023-to-tax-year-2025-to-2026" target="_blank" rel="noopener">HMRC income tax liability statistics</a>.</li>
<li><strong>Wealth.</strong> US shares are the <a href="https://www.federalreserve.gov/releases/z1/dataviz/dfa/distribute/table/" target="_blank" rel="noopener">Federal Reserve Distributional Financial Accounts</a>; UK shares are the <a href="https://www.ons.gov.uk/peoplepopulationandcommunity/personalandhouseholdfinances/incomeandwealth/bulletins/totalwealthingreatbritain/april2020tomarch2022" target="_blank" rel="noopener">ONS Wealth &amp; Assets Survey</a>.</li>
<li><strong>Comparability &amp; precision.</strong> Headline figures are anchored to the latest published values from each source and rounded. Some longer historical and pre-2020 series are compiled from the official tables and should be verified against the primary source before being quoted exactly. US and UK figures use different definitions (e.g. fiscal-year basis, the scope of "wealth"), so cross-country comparisons are directional, not exact.</li>
</ul>
</details>
