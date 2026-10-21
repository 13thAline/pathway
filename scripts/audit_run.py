#!/usr/bin/env python3
"""Audit a run's exported accounting and measurements."""

import argparse
import json
from pathlib import Path

from pathway.audit import audit

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    print(json.dumps(audit(parser.parse_args().directory)))
