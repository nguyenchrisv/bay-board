# RetroDisplay II / Radxa Zero 3W display carrier

**Status: REV A design candidate for review, not a fabrication release.** No buying, printing, machining, or power-on is authorized by this change. No archive `.f3d` files are included.

## Deliverables

- `radxa-zero-3w-carrier.step` — one valid solid, local lower-left datum, base Z=0…3 mm.
- `radxa-zero-3w-carrier.pdf` / `.png` — dimensioned carrier drawing and stack notes.
- `usb-c-power-insert.step` — one valid solid, local center datum, thickness Z=0…2.5 mm.
- `usb-c-power-insert.pdf` / `.png` — dimensioned insert drawing.
- `bom.md` — links, quantities, published prices, and calculated total.
- `verification.json` — re-import, assembly-intersection, clearance, and PDF check results.

## Assembly position and fit

Source geometry is Christopher's read-only `onyx-archive` at commit `52d17839a2197180742cce097550dd014b785cb8`, the official Radxa Zero 3W v1.11 DXF/STEP, and the archived Waveshare 4-inch HDMI LCD (C) STEP.

Case-space placements for validation:

- Carrier: translate local part by **(25.5, 22.85, 47.16) mm**.
- Radxa PCB: lower-left/bottom at **(26.9521, 24.2471, 37.56) mm**; PCB top Z=39.16 mm.
- LCD transform: rotate 90° about Z, then translate **(50, 50, 66) mm**.
- Power insert: proposed case-space center **X=77, Z=41 mm**; outline X=57…97, Z=25…57 mm. Its final pocket/curvature fit still requires case modification review.

The required **2 GB no-GPIO-header** Radxa fits. A populated-header model intersects the carrier by **6.277503 mm³** and is not allowed. The no-eMMC board's boot microSD card is included in the BOM.

### Tight clearances

- Micro-HDMI body to carrier: **4.9702 mm**.
- LCD lowest component to carrier base: **2.5000 mm**.
- Modeled 5519A heatsink metal to carrier: **3.0000 mm**.

The carrier has a **3 mm base**, integrated **3 mm LCD standoff pads**, and requires **8 mm board spacers**. A **1.1 mm wide × 1.0 mm high** lower-right relief clears the measured curved case-wall interference.

## Vents and heatsink keep-out

- Six independent carrier slots: **45 × 2 mm, R1 ends**, total opening **534.85 mm²**, above the 55 × 19 mm heatsink keep-out. Slot/HDMI-notch overlap is **0 mm³**.
- Two insert slots: **12 × 2 mm, R1 ends**, total opening **46.28 mm²**, providing low/high external vent paths on the power side.
- Heatsink metal is modeled from **3.0 to 5.0 mm above the PCB**. Metal intersections with the no-header board, case, and carrier are each **0 mm³**.
- Allow a nominal **1.4 mm SoC-only thermal pad** between the measured 1.6 mm SoC top and the heatsink metal. Do not span the pad across taller components. Final pad footprint, thickness, and 5519A attachment remain physical-fit checks.

Ventilation does **not** establish thermal approval. Radxa permits passive cooling for light/moderate use but recommends supplemental cooling for sustained load or elevated ambient temperature. Its documented governor target is 85 °C and ambient range is 0–50 °C. Christopher must run the actual Chromium dashboard for at least 60 minutes in the assembled orientation while logging SoC temperature, throttling, and case temperature. Stop for overheating, smell, or instability; reserve a fan if needed.

## Power-insert details

The insert is **40 × 32 × 2.5 mm**, R2 outer corners. The DataPro cutout was verified from the archived vector PDF:

- Central USB-C opening **10.5 × 4.6 mm, 4 × R2.0 mm**.
- Two **Ø3.2 mm** connector mounting holes on **20 mm centers**.
- **28.2 × 20 mm** connector keep-out.
- Four **Ø2.5 mm** case-attachment holes at local **(±17, ±13) mm**.
- Proposed DataPro part: **1678-0006C**, 6-inch USB-C extension, rated 100 W, with 4-40 screws.

The insert and any v27 pocket/drilling are design proposals only. Final attachment, screw lengths, and wall-curvature match remain open for Christopher's review.

## Cable and power limits

See `bom.md` for quantities and prices. Required cable chain:

1. Waveshare Micro HDMI Vertical B → 0.2 m FFC → Waveshare HDMI Vertical B → LCD.
2. Radxa **USB-C 2 USB 3.x host** → UNITEK A1040GY01 → short Adafruit 4198 C-to-C cable → UNITEK A1040GY01 → LCD USB-C.
3. Radxa **USB-C 1 OTG/power** → UNITEK A1040GY01 → DataPro panel extension → documented Radxa PD30W or certified fixed 5 V / ≥3 A supply. No fourth adapter is used at the external panel.

Set the LCD touch selector to **USB**. USB-C 1 is USB 2.0 OTG + 5 V power input; USB-C 2 is the host, not OTG. Radxa publishes **500 mA maximum** on USB-C 2; Waveshare lists this LCD at **5 V / 300 mA**, leaving **200 mA** published headroom. Christopher must verify LCD startup/run current and rail droop on the bench. Stop if LCD current exceeds 500 mA or the rail droops.

**HAZARD:** the wall adapter handles mains voltage. This is not a mains-connected design. Use a certified adapter; Christopher performs all purchasing, connection, and first power-on.

## Verification result

`verification.json` records:

- Both STEP files re-import as **one valid solid** each.
- Carrier/case, carrier/LCD, no-header board/case/carrier/LCD, heatsink/board/case/carrier, vent-slot/HDMI-notch, and all five connector-envelope/case/carrier checks: **0 mm³** unintended intersection.
- Six independent carrier vent slots and **534.85 mm²** total nominal opening; the previous notch overlap is explicitly checked and excluded.
- Both PDF files: **one page**, expected dimension text present, and **zero text words outside page bounds**.
- Both PNG drawings generated at **2571 × 1819 px** with nontrivial raster content.
- Automated assertions require all zero-intersection checks, both tight clearances ≥2 mm, valid single-solid exports, and unclipped PDF text.

The external image-analysis service timed out, so no independent visual review is claimed. Geometry checks are STEP feature measurements and boolean operations; PDF checks are text, bounds, and raster checks.

## Before fabrication or power-on

- Christopher confirms the no-header SKU, boots the selected Radxa OS image from the BOM microSD card, and measures the actual adapters/cables.
- Finalize insert pocket, case attachment, screw lengths, carrier stiffness, and print settings.
- Verify the 5519A attachment and the SoC-only thermal pad's actual footprint/thickness; do not bridge the pad onto taller components.
- Preserve antenna clearance; do not install a populated 40-pin header.
- Dry-fit without power, then bench-check 5 V polarity, voltage droop, LCD startup current, and touch.
- Run the 60-minute thermal soak; passive cooling is not pre-approved for continuous operation.

## Primary references

- [Radxa 2D DXF ZIP](https://dl.radxa.com/zero3/docs/hw/3w/radxa_zero_3w_2d_dxf.zip) and [3D STEP](https://dl.radxa.com/zero3/docs/hw/3w/radxa_zero_3w_3d_stp.zip).
- [Radxa hardware interface](https://docs.radxa.com/en/zero/zero3/hardware-design/hardware-interface), [power FAQ](https://docs.radxa.com/en/zero/zero3/faq), and [PD30W](https://docs.radxa.com/en/zero/zero3/accessories/pd-30w).
- [Waveshare LCD wiki](https://www.waveshare.com/wiki/4inch_HDMI_LCD_%28C%29), [LCD comparison](https://www.waveshare.net/cus/lcd-oled-compare.htm), and [HDMI adapters](https://www.waveshare.com/hdmi-adapter-vertical.htm).
- [UNITEK A1040GY01](https://www.unitek-products.com/products/usb4-90-degree-adapter), [Adafruit 4198](https://www.adafruit.com/product/4198), and [DataPro 1678](https://www.datapro.net/products/usb-c-panel-mount-extension-cable.html).
- [DataPro standard USB-C cutout, archived 2025-06-18](https://web.archive.org/web/20250618073953/https://www.datapro.net/drawings/cutouts/usb-c_cutout.pdf).
