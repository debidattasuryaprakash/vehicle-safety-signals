"""Export the dbt marts to dashboard/data/dashboard.json for the static dashboard.

Usage:
  TARGET=duckdb    python scripts/export_dashboard.py
  TARGET=snowflake python scripts/export_dashboard.py
Set DATA_LABEL="NHTSA" once you've loaded the real files (default: SAMPLE).
"""
import json
import os
import re
import sys
from collections import Counter
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "ingestion"))
from config import DUCKDB_PATH, TARGET  # noqa: E402

OUT = ROOT / "dashboard" / "data" / "dashboard.json"
TEXT_OUT = ROOT / "dashboard" / "data" / "signal_text.json"

# words that carry no meaning about a defect, left out of the phrase counts
STOP = set("""
a about after again all also am an and any are as at back be been before being but by can car
contact could did do does doing down during each for from had has have he her his how i if in
into is it its it's just me more my no not now of off on once only or other our out over own
same she so some such than that the their them then there these they this those through to too
under until up very vehicle was we were what when where which while who why will with would you
your year model make approximately mileage stated failure manufacturer notified dealer
""".split())


def phrases(texts, top=8):
    """The most common two-word phrases, counted once per complaint."""
    counts = Counter()
    for text in texts:
        words = [w for w in re.findall(r"[A-Z][A-Z'-]+", (text or "").upper()) if w.lower() not in STOP]
        counts.update({f"{a} {b}" for a, b in zip(words, words[1:])})
    return [[p.lower(), n] for p, n in counts.most_common(top) if n > 1]


def excerpt(text, limit=240):
    text = re.sub(r"\s+", " ", (text or "")).strip()
    return text if len(text) <= limit else text[:limit].rsplit(" ", 1)[0] + "…"


def signal_text(q):
    """Per signal: top narrative phrases, model-year mix and two example complaints."""
    rows = q("""
        select s.make, s.model, s.component_group, s.month, f.odi_number,
               max(r.cdescr) as narrative, max(r.yeartxt) as model_year
        from marts.mart_signals s
        join marts.fct_complaints f
          on f.make = s.make and f.model = s.model
         and f.component_group = s.component_group and f.received_month = s.month
        join raw.complaints r on r.odino = f.odi_number
        group by 1, 2, 3, 4, 5""")
    by_signal = {}
    for r in rows:
        key = f"{r['make']}|{r['model']}|{r['component_group']}|{clean(r['month'])}"
        by_signal.setdefault(key, []).append(r)
    out = {}
    for key, items in by_signal.items():
        texts = [i["narrative"] for i in items]
        top = phrases(texts)
        lead = top[0][0].upper() if top else ""
        # examples: complaints that use the top phrase, mid-length first
        pool = sorted((t for t in texts if t and lead in t.upper()), key=lambda t: abs(len(t) - 300)) or texts
        years = Counter(i["model_year"] for i in items if i["model_year"] and i["model_year"] != "9999")
        out[key] = {
            "phrases": top,
            "years": [[y, n] for y, n in years.most_common(3)],
            "examples": [excerpt(t) for t in pool[:2]],
        }
    return out


def connect():
    if TARGET == "snowflake":
        import snowflake.connector
        con = snowflake.connector.connect(
            account=os.environ["SNOWFLAKE_ACCOUNT"], user=os.environ["SNOWFLAKE_USER"],
            password=os.environ["SNOWFLAKE_PASSWORD"], role=os.getenv("SNOWFLAKE_ROLE"),
            warehouse=os.environ["SNOWFLAKE_WAREHOUSE"], database=os.environ["SNOWFLAKE_DATABASE"],
        )
        cur = con.cursor()
        def query(sql):
            cur.execute(sql)
            cols = [c[0].lower() for c in cur.description]
            return [dict(zip(cols, r)) for r in cur.fetchall()]
        return query
    import duckdb
    con = duckdb.connect(str(DUCKDB_PATH), read_only=True)
    def query(sql):
        res = con.execute(sql)
        cols = [c[0].lower() for c in res.description]
        return [dict(zip(cols, r)) for r in res.fetchall()]
    return query


def clean(v):
    if isinstance(v, (date, datetime)):
        return v.isoformat()[:10]
    if isinstance(v, Decimal):
        return float(v)
    return v


def rows(query, sql):
    return [{k: clean(v) for k, v in r.items()} for r in query(sql)]


def main():
    q = connect()
    monthly = rows(q, """
        select make, received_month as month, count(*) as complaints,
               sum(case when is_crash then 1 else 0 end) as crashes
        from marts.fct_complaints
        where received_month <= (select max(month) from marts.mart_model_component_monthly)
        group by 1, 2 order by 2, 1""")
    components = rows(q, """
        with mx as (select max(month) as m from marts.mart_model_component_monthly)
        select make, component_group, count(*) as complaints
        from marts.fct_complaints, mx
        where received_month <= mx.m and received_month > """ + ("dateadd(month, -12, mx.m)" if TARGET == "snowflake"
                                       else "mx.m - interval 12 month") + """
        group by 1, 2""")
    signals = rows(q, """
        select make, model, component_group, month, complaints, baseline_mean,
               ratio_to_baseline, z_score, next_recall_date, days_to_recall, next_recall_campaign,
               next_investigation_date, next_investigation_number, days_to_investigation,
               followup_complete
        from marts.mart_signals order by month desc, z_score desc""")
    backtest = rows(q, """
        select min_z, ratio, slice, outcome, signals, hits, hit_rate, eligible_months, base_rate,
               lift, median_days_to_outcome, is_current
        from marts.mart_signal_backtest order by outcome, slice, ratio, min_z""")
    # monthly history of every pair that has a signal, as compact arrays
    # (one object per pair) to keep the file small
    series = []
    for r in rows(q, """
        select m.make, m.model, m.component_group, m.month, m.complaints, m.baseline_mean, m.is_signal
        from marts.mart_model_component_monthly m
        join (select distinct make, model, component_group from marts.mart_signals) s
          on s.make = m.make and s.model = m.model and s.component_group = m.component_group
        order by 1, 2, 3, 4"""):
        pair = (r["make"], r["model"], r["component_group"])
        if not series or (series[-1]["make"], series[-1]["model"], series[-1]["component_group"]) != pair:
            series.append({"make": r["make"], "model": r["model"], "component_group": r["component_group"], "start": r["month"],
                           "complaints": [], "baseline": [], "signal": []})
        s = series[-1]
        if r["is_signal"]:
            s["signal"].append(len(s["complaints"]))
        s["complaints"].append(r["complaints"])
        s["baseline"].append(None if r["baseline_mean"] is None else round(r["baseline_mean"], 1))
    # the dashboard lists 20 recalls per view, so ship each make's top 20
    # (which covers the overall top 20) plus campaign counts for the tiles
    recalls = rows(q, """
        select campaign_number, make, model, component_group, report_received_date,
               potentially_affected, complaints_180d_before_recall, complaints_before_recall
        from marts.mart_complaint_to_recall
        where make in (select distinct make from marts.fct_complaints)
        qualify row_number() over (partition by make order by complaints_180d_before_recall desc,
                                   report_received_date desc) <= 20
        order by complaints_180d_before_recall desc, report_received_date desc""")
    recall_counts = rows(q, """
        select make, count(distinct campaign_number) as campaigns
        from marts.fct_recalls group by 1""")
    totals = rows(q, """
        select (select count(distinct odi_number) from marts.fct_complaints) as complaints,
               (select count(distinct campaign_number) from marts.fct_recalls) as recalls,
               (select min(received_month) from marts.fct_complaints) as first_month,
               (select max(month) from marts.mart_model_component_monthly) as last_month,
               (select max(received_date) from marts.fct_complaints) as last_received""")[0]
    data = {
        "meta": {
            "data_label": os.getenv("DATA_LABEL", "SAMPLE").strip(),
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="minutes"),
            **totals,
        },
        "monthly": monthly, "components": components, "signals": signals,
        "series": series, "recalls": recalls, "recall_counts": recall_counts,
        "backtest": backtest,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, separators=(",", ":")))
    print(f"Wrote {OUT} ({OUT.stat().st_size / 1024:.0f} KB): "
          f"{len(signals)} signals, {len(recalls)} recalls")
    # narratives are only needed when someone opens a signal, so they ship separately
    TEXT_OUT.write_text(json.dumps(signal_text(q), separators=(",", ":"), ensure_ascii=False))
    print(f"Wrote {TEXT_OUT} ({TEXT_OUT.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
