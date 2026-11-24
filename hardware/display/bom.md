# RetroDisplay II / Radxa Zero 3W BOM

**Design review only — no purchase approval.** Prices are published USD prices observed on **2026-11-24**, before tax and shipping. Availability and prices must be rechecked by Christopher. Existing RetroDisplay II enclosure and Waveshare LCD are excluded. Printed carrier/insert material is excluded.

| Item | Required variant | Qty | Unit price | Extended | Source |
|---|---|---:|---:|---:|---|
| Radxa Zero 3W | 2 GB RAM, no eMMC, **without GPIO header** | 1 | $69.99 | $69.99 | [Amazon B0CZD3QN3D](https://amazon.com/dp/B0CZD3QN3D) |
| Boot medium | Official Raspberry Pi SC1629 microSD, 64 GB, A2/V30, blank; image for Radxa | 1 | $30.95 | $30.95 | [PiShop — listed IN STOCK](https://www.pishop.us/product/raspberry-pi-sd-card-64gb/) |
| Wall supply | Radxa Power PD30W with USB-C cable; use as documented | 1 | $12.95 | $12.95 | [ameriDroid U0941](https://ameridroid.com/products/radxa-power-pd-30w-with-usb-c-cable) |
| SoC heatsink | Radxa Heatsink 5519A, 55 × 19 × 2 mm | 1 | $2.50 | $2.50 | [Arace](https://arace.tech/products/heatsink-5519a-for-radxa-zero-3w-radxa-zero-3e) |
| Radxa HDMI adapter | Micro HDMI Adapter (Vertical) (B), 16.0 × 14.5 × 12.5 mm | 1 | $2.99 | $2.99 | [Waveshare adapter page](https://www.waveshare.com/hdmi-adapter-vertical.htm) |
| LCD HDMI adapter | HDMI Adapter (Vertical) (B), 16.0 × 15.0 × 14.3 mm | 1 | $2.99 | $2.99 | [Waveshare adapter page](https://www.waveshare.com/hdmi-adapter-vertical.htm) |
| HDMI interconnect | 0.2 m, 20-pin, 0.5 mm pitch, opposite-side contacts | 1 | $0.99 | $0.99 | [Waveshare SKU 14721](https://www.waveshare.com/ffc-20pin-0.5pitch-0.2m-opposite-side-contact.htm) |
| USB-C up/down adapters | UNITEK A1040GY01; one each at Radxa host, Radxa power, and LCD | 3 | $5.99 | $17.97 | [UNITEK](https://www.unitek-products.com/products/usb4-90-degree-adapter) |
| LCD USB jumper | Short C-to-C cable with data, power and CC | 1 | $8.50 | $8.50 | [Adafruit 4198](https://www.adafruit.com/product/4198) |
| Panel power connector | DataPro 1678-0006C, 6-inch C-to-C extension; 4-40 hardware included | 1 | $19.45 | $19.45 | [DataPro 1678-0006C](https://www.datapro.net/products/usb-c-panel-mount-extension-cable.html) |
| M2.5 mounting hardware | Nylon screw/standoff set; use 8 mm F-F standoffs, select screw lengths at dry fit | 1 | $14.95 | $14.95 | [Adafruit 3658](https://www.adafruit.com/product/3658) |
| **Priced-item total** | | | | **$184.23** | Calculated from the rows above |

## Pricing and design notes

- Waveshare's adapter page publishes a **$2.79–$2.99 range**; this BOM reserves the upper **$2.99** for each required adapter. Confirm the selected SKU price before purchase.
- The populated-header Radxa is **not compatible** with this carrier. Do not substitute it without redesign.
- The integrated 3 mm LCD pads are part of the carrier STEP; there is no separate 3 mm shim line item.
- DataPro includes 4-40 mounting screws. Four case-attachment holes are provided in the insert, but final case fasteners depend on Christopher's approved pocket/attachment method.
- No alternates are electrically or mechanically drop-in unless their connector direction and dimensions match the verified envelopes.
