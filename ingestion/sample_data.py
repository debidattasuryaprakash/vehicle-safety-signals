"""Generate a SYNTHETIC sample shaped exactly like the NHTSA flat files.

Used by CI and for a first local run before you download the real data.
Nothing produced here is real; never quote findings from it.
"""
import random
from datetime import date, timedelta

from config import RAW_DIR, SCHEMA

random.seed(42)
START, END = date(2024, 1, 1), date(2026, 9, 30)

VEHICLES = {
    "TOYOTA": ["CAMRY", "RAV4", "COROLLA", "HIGHLANDER"],
    "FORD": ["F-150", "EXPLORER", "ESCAPE", "BRONCO"],
    "HONDA": ["CIVIC", "CR-V", "ACCORD", "PILOT"],
    "CHEVROLET": ["SILVERADO", "EQUINOX", "MALIBU", "TAHOE"],
    "HYUNDAI": ["TUCSON", "ELANTRA", "SANTA FE", "PALISADE"],
    "TESLA": ["MODEL 3", "MODEL Y"],
    "NISSAN": ["ROGUE", "ALTIMA", "SENTRA"],
    "KIA": ["SPORTAGE", "TELLURIDE", "SORENTO"],
}
COMPONENTS = {
    "ELECTRICAL SYSTEM": ["BATTERY", "WIRING", "12V BATTERY"],
    "ENGINE": ["ENGINE", "ENGINE COOLING"],
    "POWER TRAIN": ["AUTOMATIC TRANSMISSION", "DRIVELINE"],
    "SERVICE BRAKES": ["HYDRAULIC", "ANTILOCK"],
    "STEERING": ["ELECTRIC POWER ASSIST", "COLUMN"],
    "AIR BAGS": ["FRONTAL", "SIDE/WINDOW"],
    "FORWARD COLLISION AVOIDANCE": ["AUTOMATIC EMERGENCY BRAKING"],
    "BACK OVER PREVENTION": ["REARVIEW CAMERA"],
    "SUSPENSION": ["FRONT", "REAR"],
    "FUEL/PROPULSION SYSTEM": ["FUEL PUMP", "HYBRID PROPULSION"],
    "STRUCTURE": ["BODY"],
    "LATCHES/LOCKS/LINKAGES": ["DOORS"],
}
# Injected defects: (make, model, component group, first month, peak multiplier)
SPIKES = [
    ("HYUNDAI", "TUCSON", "ELECTRICAL SYSTEM", date(2025, 3, 1), 6),
    ("FORD", "EXPLORER", "BACK OVER PREVENTION", date(2025, 8, 1), 5),
    ("TESLA", "MODEL Y", "FORWARD COLLISION AVOIDANCE", date(2026, 5, 1), 5),
    ("HONDA", "CR-V", "FUEL/PROPULSION SYSTEM", date(2024, 9, 1), 4),
    ("KIA", "TELLURIDE", "AIR BAGS", date(2026, 7, 1), 5),
]


def months():
    d = START
    while d <= END:
        yield d
        d = (d.replace(day=28) + timedelta(days=4)).replace(day=1)


def fmt(d: date) -> str:
    return d.strftime("%Y%m%d")


def row(columns, values):
    return "\t".join(values.get(c, "") for c in columns)


def main():
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    cc = SCHEMA["complaints"]["columns"]
    rc = SCHEMA["recalls"]["columns"]
    complaints, recalls = [], []
    cmplid, odino = 1_000_000, 11_500_000
    for m in months():
        for make, models in VEHICLES.items():
            for model in models:
                for group, subs in COMPONENTS.items():
                    lam = random.uniform(1.0, 5.0)
                    for mk, md, grp, first, mult in SPIKES:
                        if (make, model, group) == (mk, md, grp) and m >= first:
                            age = (m.year - first.year) * 12 + m.month - first.month
                            lam *= 1 + (mult - 1) * max(0.0, 1 - age / 10)
                    for _ in range(max(0, round(random.gauss(lam, lam ** 0.5)))):  # roughly Poisson
                        odino += 1
                        received = m + timedelta(days=random.randint(0, 27))
                        failed = received - timedelta(days=random.randint(0, 120))
                        year = str(random.choice([2019, 2020, 2021, 2022, 2023, 2024, 2025, 9999]))
                        comps = [f"{group}:{random.choice(subs)}"]
                        if random.random() < 0.15:  # some complaints list 2 components
                            g2 = random.choice(list(COMPONENTS))
                            comps.append(f"{g2}:{random.choice(COMPONENTS[g2])}")
                        for comp in comps:
                            cmplid += 1
                            complaints.append(row(cc, {
                                "CMPLID": str(cmplid), "ODINO": str(odino),
                                "MFR_NAME": f"{make.title()} Motor Co.",
                                # mimic real-file messiness: odd case and spaces
                                "MAKETXT": make if random.random() > 0.03 else f" {make.lower()} ",
                                "MODELTXT": model,
                                "YEARTXT": year,
                                "CRASH": "Y" if random.random() < 0.06 else "N",
                                "FIRE": "Y" if random.random() < 0.015 else "N",
                                "INJURED": str(random.choice([0] * 30 + [1, 2])),
                                "DEATHS": "0",
                                "COMPDESC": comp,
                                "STATE": random.choice(["CA", "TX", "FL", "NY", "OH", "MI", "WA"]),
                                "FAILDATE": fmt(failed),
                                "DATEA": fmt(received + timedelta(days=2)),
                                "LDATE": fmt(received) if random.random() > 0.01 else "",
                                "MILES": str(random.randint(100, 90_000)),
                                "CDESCR": "SYNTHETIC SAMPLE RECORD",
                                "PROD_TYPE": "V",
                            }))
    # recalls follow each spike after a lag; plus background recalls
    rid, camp = 200_000, 0
    def recall(make, model, group, when, potaff):
        nonlocal rid, camp
        camp += 1
        for year in (2022, 2023, 2024):
            rid += 1
            recalls.append(row(rc, {
                "RECORD_ID": str(rid), "CAMPNO": f"{when:%y}V{camp:03d}000",
                "MAKETXT": make, "MODELTXT": model, "YEARTXT": str(year),
                "COMPNAME": f"{group}:{random.choice(COMPONENTS[group])}",
                "MFGNAME": f"{make.title()} Motor Co.", "RCLTYPECD": "V",
                "POTAFF": str(potaff), "RCDATE": fmt(when), "DATEA": fmt(when + timedelta(days=5)),
                "DESC_DEFECT": "SYNTHETIC SAMPLE RECALL",
            }))
    for mk, md, grp, first, _ in SPIKES:
        lag = timedelta(days=random.randint(120, 260))
        if first + lag <= END:
            recall(mk, md, grp, first + lag, random.randint(20_000, 400_000))
    for _ in range(40):
        mk = random.choice(list(VEHICLES))
        recall(mk, random.choice(VEHICLES[mk]), random.choice(list(COMPONENTS)),
               START + timedelta(days=random.randint(0, (END - START).days)), random.randint(500, 90_000))
    # split complaints across the real period files by received year, like NHTSA does
    files = SCHEMA["complaints"]["files"]
    ldate = cc.index("LDATE")
    for f in files:
        first, last = (int(y) for y in f["file"].rsplit("_", 1)[1][:9].split("-"))
        part = [c for c in complaints if first <= int(c.split("\t")[ldate][:4] or 0) <= last
                or (not c.split("\t")[ldate] and f is files[-1])]
        (RAW_DIR / f["file"]).write_text("\n".join(part) + "\n", encoding="latin-1")
    (RAW_DIR / SCHEMA["recalls"]["files"][0]["file"]).write_text("\n".join(recalls) + "\n", encoding="latin-1")
    print(f"Wrote {len(complaints):,} synthetic complaint rows and {len(recalls):,} recall rows to {RAW_DIR}")


if __name__ == "__main__":
    main()
