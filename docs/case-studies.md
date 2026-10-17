# Case studies: strong signals with no recall

The backtest says a complaint spike barely raises the chance of a recall on the same model and
component (1.05× the base rate). So what are the strongest signals that *weren't* followed by a
recall? Two of them, read through their complaint narratives (`CDESCR`) and NHTSA's
investigations file (`FLAT_INV.txt`).

## Tesla Model 3 and Model Y, service brakes, February 2022

| | Model 3 | Model Y |
|---|---|---|
| Complaints in Feb 2022 | 113 | 84 |
| Trailing 12-month baseline | 2.4 | 1.5 |
| z-score | 71.1 | 67.4 |
| Recall on the same model and component within a year | none | none |

**What owners describe.** One failure mode. Of the 113 Model 3 complaints, 58 mention cruise
control and 32 use the phrase "phantom braking": the car brakes hard on the highway for no
visible reason, usually with adaptive cruise on. 77 of the 113 are 2021–2022 model years. 112
came through NHTSA's online form.

**What happened next.** NHTSA opened a preliminary evaluation, **PE22-002 "Unexpected Brake
Activation"**, on 16 February 2022, in the same month, covering Model 3, Model S and Model Y. It
closed on 29 June 2026 without a recall campaign.

**What this shows about the method.**

- The signal was real: it matched an investigation NHTSA opened at the same time. A recall-only
  outcome scores it as a miss. Investigations are an outcome worth adding to the backtest.
- The investigation's component is *Forward Collision Avoidance: Adaptive Cruise Control*, while
  owners filed the complaints under *Service Brakes*. Even an outcome matched on component group
  would have missed it.
- Lead time was zero. Owners and NHTSA saw the problem at the same time, so this is detection,
  not early warning.

## Chrysler Pacifica, steering, September 2025

| | |
|---|---|
| Complaints in Sep 2025 | 81 |
| Trailing 12-month baseline | 3.0 |
| z-score | 45.0 |
| Complaints per month before / after | 2–7 (Jun–Aug) / 19, 10, 10 (Oct–Dec) |
| Recall on the same model and component within a year | none |
| NHTSA investigation | none in `FLAT_INV.txt` |

**What owners describe.** Steering that is hard to turn or sticks, especially coming out of a
turn, and doesn't return to centre on its own. "Steering wheel" appears in 51 narratives and
"power steering" in 13. 67 of the 81 complaints are 2017–2018 model years. The one Pacifica
steering recall on file, 24V199000, covers 2023–2024 vehicles, so it doesn't apply.

**Two data-quality findings.**

- 21 of the 81 complaints are written in the third person ("the contact owns a 2017 Chrysler
  Pacifica… the contact stated…"). That is how NHTSA's hotline staff write up phone complaints
  (`CMPL_TYPE = EVOQ`). Online complaints rose from 5 to 60 in the same month, so the spike shows
  up in both channels, not just one.
- At least one narrative is pasted output from an AI writing assistant ("here's a more natural,
  human-sounding version of your NHTSA report draft"). Text analysis of complaints now needs to
  allow for drafted, templated wording.

**What I would do next.** Read the narratives month by month to see whether the October–December
complaints describe the same symptom. Look for a manufacturer service bulletin on 2017–2018
Pacifica steering. Check whether a forum post or news story in September 2025 prompted the burst.
The level stayed raised afterwards (10–19 a month against 2–7 before), which argues against a
one-off reaction.

## How these were found

```sql
select make, model, component_group, month, complaints, baseline_mean, z_score
from marts.mart_signals
where followup_complete and next_recall_date is null
order by z_score desc;
```

Narrative phrases come from counting word pairs in `raw.complaints.cdescr` for each
model, component and month. Investigations come from NHTSA's `FLAT_INV.zip`
(https://static.nhtsa.gov/odi/ffdd/inv/FLAT_INV.zip), which isn't part of the pipeline yet.
