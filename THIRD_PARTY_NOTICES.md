# Third-party notices

Pathway's MIT license applies to original project files. It does not relicense dependencies or referenced publications.

- [JuPedSim](https://github.com/PedestrianDynamics/jupedsim) 1.4.2: LGPL-3.0-or-later, as stated in its distributed license file. Preserve its applicable notices and distribution obligations.
- [PedPy](https://pedpy.readthedocs.io/stable/) 1.5.1: MIT; optional trajectory analysis and verification.
- Pydantic, NumPy, Shapely and other dependencies are installed under their respective package licenses. Exact versions are recorded in `uv.lock`; package distributions include their own license files.
- NDMA, *Managing Crowd at Events and Venues of Mass Gathering* (2014), is background planning material. The [official guide](https://ndma.gov.in/sites/default/files/PDF/Reports/managingcrowdsguide.pdf) is not redistributed here. Reference to the guide does not imply endorsement.

Browser application dependencies are pinned in `web/package-lock.json`. React, React DOM and Phosphor Icons use the MIT license; Geist uses the SIL Open Font License 1.1. Their notices ship with the browser build under `licenses/`. Vite, Tailwind CSS, TypeScript, Vitest, Playwright and Prettier are development/build dependencies under their respective package licenses. Fonts are served locally; no external font service is required.

## Accessibility reference

Pathway links to the 2025 UN India / UNESCO / IIT Kharagpur guide, *A practical guide on applying principles of inclusion and universal design standards in Durga Puja Pandals*: https://india.un.org/sites/default/files/2025-10/English%20SOP%20.pdf. Selected numerical checks and section references support manual inspection; this repository does not distribute the PDF or its illustrations. The publication identifies CC BY-SA 4.0 for its text and separate conditions for other materials. Consult the original publication for its scope, contextual requirements and terms.
