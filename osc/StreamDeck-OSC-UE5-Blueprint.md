# Stream Deck -> OSC -> UE5: Live Stunt & VFX Override Rig

Status labels follow the RooCording evidence vocabulary.

- **CODE-REAL:** `roocording_osc_stage_core.mjs` + `roocording_osc_stage_tdd.mjs`
  (8/8 acceptance tests pass in Node). Pure OSC 1.0 wire encode/decode, UDP
  listener on port 8000, the 16-button address map as single source of truth,
  and the override state machine (blend-weight ramp, auto-release, reset)
  that `BP_StageOSCManager` mirrors. Run the listener on the render machine to
  validate the Stream Deck plugin's target IP/port and the full mapping
  **before** opening UE5: `node -e "import('./roocording_osc_stage_core.mjs').then(m=>m.listen({port:8000}))"`
- **SPEC-ONLY:** the physical Stream Deck hardware steps and the UE5 Blueprint
  graphs below. No Unreal Editor exists in the build sandbox; these steps are
  the exact recipe, nothing more is claimed.

---

## Part 1: Stream Deck Plugin & Live Button Layout

### 1. Software & Plugin Setup
1. Open the **Elgato Stream Deck** application.
2. Click the **Stream Deck Store** icon (top right) and search for/install either:
   * **OSC Plugin** (Recommended for UE5: *OSC by BarRaider* or *OSC Tools*)
   * **MIDI Plugin** (e.g., *Stream Deck MIDI by Trep*)
3. In the plugin settings, set the Target IP to your **UE5 Render Machine's IP** (or `127.0.0.1` if running on the same PC) and set the Target Port to **`8000`** (UDP).

### 2. Stream Deck 4x4 Live Stunt Layout Mapping

| Button Slot | Label | OSC Address | Value / Function |
| :--- | :--- | :--- | :--- |
| **Row 1, Col 1** | **RESET / LIVE MOCAP** | `/kimmy/override/reset` | `1.0` (Clears all overrides, reverts to live tracking) |
| **Row 1, Col 2** | **BACKFLIP STUNT** | `/kimmy/stunt/backflip` | `1.0` (Plays pre-cached backflip montage) |
| **Row 1, Col 3** | **SPIN DANCE** | `/kimmy/stunt/spindance` | `1.0` (Triggers 360° spin pose blend) |
| **Row 1, Col 4** | **FLOAT / LEVITATE** | `/kimmy/stunt/levitate` | `1.0` (Toggles anti-gravity mesh offset) |
| **Row 2, Col 1** | **FIERCE EXPRESSION** | `/kimmy/emote/fierce` | `1.0` (Blends facial curves: BrowDown + JawTight) |
| **Row 2, Col 2** | **SMILE / POP** | `/kimmy/emote/smile` | `1.0` (Blends facial curves: MouthSmile + CheekSquint) |
| **Row 2, Col 3** | **SHOCK / GASP** | `/kimmy/emote/shock` | `1.0` (Blends facial curves: JawOpen + EyeWide) |
| **Row 2, Col 4** | **GLITCH EMOTE** | `/kimmy/emote/glitch` | `1.0` (Rapid random blendshape jitter) |
| **Row 3, Col 1** | **FLAME HANDS** | `/kimmy/vfx/flames` | `1.0` (Spawns Niagara fire emitters on hands) |
| **Row 3, Col 2** | **LIGHTNING BURST** | `/kimmy/vfx/lightning` | `1.0` (Fires electric arc particles from chest) |
| **Row 3, Col 3** | **SPECTRAL DUST** | `/kimmy/vfx/dust` | `1.0` (Spawns glowing particle trail behind avatar) |
| **Row 3, Col 4** | **HOLO-GLITCH FX** | `/kimmy/vfx/hologlitch` | `1.0` (Switches material shader to RGB split) |
| **Row 4, Col 1** | **CAM 1: FRONT FULL** | `/kimmy/cam/front` | `1.0` (Switches nDisplay view to Front Camera) |
| **Row 4, Col 2** | **CAM 2: CLOSEUP** | `/kimmy/cam/closeup` | `1.0` (Switches nDisplay view to Head Camera) |
| **Row 4, Col 3** | **CAM 3: SIDE PROFILE** | `/kimmy/cam/side` | `1.0` (Switches nDisplay view to 45° Camera) |
| **Row 4, Col 4** | **EMERGENCY T-POSE** | `/kimmy/override/tpose` | `1.0` (Safety reset if MoCap tracking degrades) |

---

## Part 2: UE5 OSC Listener & Stunt Override Blueprint Setup

To receive and process these Stream Deck signals inside Unreal Engine 5 in real time:

### Step 1: Enable the OSC Plugin in UE5
1. Go to **Edit > Plugins**, search for **OSC**, and check **Enabled**.
2. Restart Unreal Engine.

### Step 2: Create the OSC Server Actor (`BP_StageOSCManager`)
1. Create a new **Blueprint Actor** named `BP_StageOSCManager` and place it in your live stage level.
2. Open `BP_StageOSCManager` and go to the **Event Graph**.
3. On **Event BeginPlay**:
   * Add a **Create OSC Server** node.
   * Set **Receive IP** to `0.0.0.0` (listens on all local network adapters).
   * Set **Port** to `8000`.
   * Check **Start Listening**.
   * Drag from the return value and promote it to a variable named `OSCServer`.
4. Drag from `OSCServer` and call **Bind Event to On OSC Message Received**.

```text
[Event BeginPlay] ──> [Create OSC Server (Port 8000)] ──> [Bind Event to OnOSCMessageReceived]
                                                                     │
                                                                     ▼
                                                     [Custom Event: HandleOSCInput]
```

### Step 3: Parse Incoming Stream Deck Commands
Inside the custom event bound to `OnOSCMessage Received`:

1. Drag out from the **OSC Message** pin and call **Get OSC Message Address**.
2. Convert the address to a String and route it into a **Switch on String** node (cases match `STAGE_MAP` in `roocording_osc_stage_core.mjs` exactly):
   * **Case `/kimmy/stunt/backflip`**:
     1. Call **Play Anim Montage** on Kimmy's Character Mesh, playing `AM_Backflip`.
     2. Temporarily set the **AnimBP Blend Weight** to `1.0` (blending away from live MoCap tracking for 2.5 seconds).
     3. Add a **Delay (2.5s)** node, then set **Blend Weight** back to `0.0` to smoothly blend back into live MoCap tracking.
   * **Case `/kimmy/vfx/flames`**:
     1. Call **Spawn System Attached** (Niagara System `NS_HandFlames`).
     2. Attach to sockets `hand_l_socket` and `hand_r_socket` on Kimmy's skeletal mesh.
   * **Case `/kimmy/override/reset`**:
     1. Stop all active Montages.
     2. Deactivate spawned Niagara systems.
     3. Reset AnimBP blend weight back to `0.0` (100% live MoCap).

### Step 4: AnimBP Layered Stunt Blend Logic
In Kimmy's **Animation Blueprint (`AnimBP`)**:

```text
[Live Link Pose (MoCap Body)] ──┐
                               ├──> [Blend Poses by Weight] ──> [Output Pose]
[Stunt Montage / Pre-cached]  ──┘          ▲
                                           │
                              (OSC Stunt Blend Weight Variable)
```

1. Create a Float variable in the AnimBP named `StuntBlendWeight`.
2. Connect both the **Live Link Pose** (tracking) and the **Stunt Pose/Montage** into a **Blend Poses by Weight** node.
3. When Stream Deck triggers a stunt, `StuntBlendWeight` ramps to `1.0`. Once the stunt completes, it ramps back to `0.0`, seamlessly returning Kimmy to live performer tracking.

This setup gives the stage operator instant, physical button access to trigger spectacular stunts, facial expressions, and particle effects without ever breaking her live motion tracking stream.

---

## Behavior contract (verified by the TDD suite)

| Input | Behavior |
| :--- | :--- |
| `/kimmy/stunt/backflip` | montage `AM_Backflip`, blend 0->1, auto-release at 2.5 s, blend ->0 |
| `/kimmy/stunt/spindance` | montage `AM_SpinDance`, blend 0->1, auto-release at 2.0 s |
| `/kimmy/stunt/levitate` | toggle; persists until pressed again or reset |
| `/kimmy/emote/*` | persists until another emote or reset (glitch = jitter) |
| `/kimmy/vfx/*` | toggle accumulate; flames attach both hand sockets |
| `/kimmy/cam/*` | mutually exclusive (latest wins) |
| `/kimmy/override/tpose` | latches full override until reset (safety) |
| `/kimmy/override/reset` | clears everything; 100% live MoCap |
| anything else | logged as unknown, never executed, never crashes |

Wire format: OSC 1.0 message, `",f"` typetag, value `1.0` big-endian float, strings 4-byte aligned — identical to what the CODE-REAL encoder produces and the test suite round-trips.
