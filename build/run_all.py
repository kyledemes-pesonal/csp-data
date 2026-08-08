"""Run every build script in dependency order. Safe to re-run: heavy steps are cached
in data-raw/ (delete the relevant cache files to force a full refetch)."""
import subprocess
import sys
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ORDER = ["build_journals.py", "build_metrics.py", "build_intel.py",
         "build_peers.py", "build_citing.py", "build_crossref.py"]

for script in ORDER:
    print(f"\n=== {script} ===", flush=True)
    r = subprocess.run([sys.executable, os.path.join(HERE, script)])
    if r.returncode != 0:
        sys.exit(f"{script} failed ({r.returncode}); fix and re-run — completed steps are cached.")
print("\nAll builds complete.")
