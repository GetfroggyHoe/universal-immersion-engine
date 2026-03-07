
import { haptics } from "./reality.js";
import { notify } from "./notifications.js";

function processCommand(cmd) {
    const ta = document.getElementById("send_textarea");
    if (!ta) return;
    const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    nativeTextAreaValueSetter.call(ta, cmd);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    const send = document.getElementById("send_but");
    if (send) send.click();
}

// ==========================================
// LOCKPICKING (Safe Cracking)
// ==========================================

export class LockPicker {
    constructor() {
        this.active = false;
        this.combination = [];
        this.currentStage = 0;
        this.currentAngle = 0;
        this.dial = null;
        this.status = null;
        this.lastHaptic = 0;
    }

    init() {
        // Inject UI if missing
        if (!document.getElementById("re-lockpick-modal")) {
            const modal = document.createElement("div");
            modal.id = "re-lockpick-modal";
            modal.style.cssText = "display:none; position:fixed; inset:0; background:rgba(0,0,0,0.9); z-index:20000; flex-direction:column; align-items:center; justify-content:center; user-select:none;";
            modal.innerHTML = `
                <h2 style="color:#cba35c; font-family:'Cinzel',serif; margin-bottom:20px;">SECURITY OVERRIDE</h2>
                <div id="re-dial-ring" style="width:300px; height:300px; border-radius:50%; border:4px solid #444; position:relative; background: radial-gradient(#222, #111);">
                    <div id="re-dial-marker" style="position:absolute; top:10px; left:50%; transform:translateX(-50%); width:4px; height:20px; background:#cba35c;"></div>
                    <div id="re-dial-knob" style="width:100%; height:100%; border-radius:50%; position:absolute; top:0; left:0; transition: transform 0.1s cubic-bezier(0.1, 0.7, 1.0, 0.1);">
                        <div style="position:absolute; top:0; left:50%; width:2px; height:50%; background:linear-gradient(to bottom, #cba35c 50%, transparent 50%); transform:translateX(-50%);"></div>
                    </div>
                </div>
                <div id="re-lock-status" style="margin-top:30px; color:#fff; font-family:monospace; font-size:1.5em;">LOCKED</div>
                <div style="margin-top:20px; color:#666; font-size:0.8em;">Rotate to find the sweet spot. Tap center to confirm.</div>
                <button id="re-lock-close" style="margin-top:30px; background:transparent; border:1px solid #666; color:#888; padding:10px 20px; border-radius:8px; cursor:pointer;">ABORT</button>
            `;
            document.body.appendChild(modal);

            // Bind Events
            const ring = document.getElementById("re-dial-ring");

            // Rotation Logic
            const handleRotate = (e) => {
                if (!this.active) return;
                const rect = ring.getBoundingClientRect();
                const cx = rect.left + rect.width / 2;
                const cy = rect.top + rect.height / 2;
                const x = (e.clientX || e.touches[0].clientX) - cx;
                const y = (e.clientY || e.touches[0].clientY) - cy;
                let deg = Math.atan2(y, x) * 180 / Math.PI + 90;
                if (deg < 0) deg += 360;

                this.updateDial(deg);
            };

            ring.addEventListener("pointermove", (e) => {
                if (e.buttons === 1) handleRotate(e);
            });
            ring.addEventListener("touchmove", handleRotate);

            // Confirm Click
            ring.addEventListener("click", () => this.confirm());

            document.getElementById("re-lock-close").addEventListener("click", () => this.stop());
        }

        this.dial = document.getElementById("re-dial-knob");
        this.status = document.getElementById("re-lock-status");

        // Command Hook
        window.startLockpick = () => this.start();
        console.log("[UIE] Lockpicking Minigame Initialized");
    }

    start() {
        this.active = true;
        this.combination = [
            Math.floor(Math.random() * 360),
            Math.floor(Math.random() * 360),
            Math.floor(Math.random() * 360)
        ];
        this.currentStage = 0;
        this.currentAngle = 0;
        document.getElementById("re-lockpick-modal").style.display = "flex";
        this.updateStatus("SEQUENCE 1/3");
    }

    stop() {
        this.active = false;
        document.getElementById("re-lockpick-modal").style.display = "none";
    }

    updateStatus(text, color="#fff") {
        if (this.status) {
            this.status.textContent = text;
            this.status.style.color = color;
        }
    }

    updateDial(deg) {
        this.currentAngle = deg;
        if (this.dial) {
            this.dial.style.transform = `rotate(${deg}deg)`;
        }

        // Check proximity
        const target = this.combination[this.currentStage];
        const diff = Math.abs(deg - target);
        const dist = Math.min(diff, 360 - diff);

        // Haptics
        const now = Date.now();
        if (dist < 15) {
            // Sweet spot
            if (now - this.lastHaptic > (dist * 10 + 20)) {
                haptics.vibratePWM(10, 1.0 - (dist / 15));
                this.lastHaptic = now;
            }
            this.dial.style.boxShadow = `0 0 ${20 - dist}px #cba35c`;
        } else {
            this.dial.style.boxShadow = "none";
        }
    }

    confirm() {
        if (!this.active) return;
        const target = this.combination[this.currentStage];
        const diff = Math.abs(this.currentAngle - target);
        const dist = Math.min(diff, 360 - diff);

        if (dist < 10) {
            // Success
            haptics.texture("success");
            this.currentStage++;
            if (this.currentStage >= 3) {
                this.updateStatus("ACCESS GRANTED", "#0f0");
                setTimeout(() => {
                    this.stop();
                    processCommand("/unlock");
                    notify("success", "Lock Bypassed", "Security");
                }, 1000);
            } else {
                this.updateStatus(`SEQUENCE ${this.currentStage + 1}/3`, "#cba35c");
            }
        } else {
            // Fail
            haptics.texture("error");
            this.updateStatus("ERROR - RETRY", "#f00");
            setTimeout(() => this.updateStatus(`SEQUENCE ${this.currentStage + 1}/3`), 1000);
        }
    }
}

export const lockPicker = new LockPicker();

export function initLockpicking() {
    lockPicker.init();
}

// ==========================================
// SCRATCH CARD (Lottery)
// ==========================================

export class ScratchCard {
    constructor() {
        this.active = false;
        this.canvas = null;
        this.ctx = null;
        this.width = 300;
        this.height = 150;
        this.threshold = 0.6; // 60% cleared
    }

    init() {
        if (!document.getElementById("re-scratch-modal")) {
            const modal = document.createElement("div");
            modal.id = "re-scratch-modal";
            modal.style.cssText = "display:none; position:fixed; inset:0; background:rgba(0,0,0,0.8); z-index:20000; align-items:center; justify-content:center; flex-direction:column;";
            modal.innerHTML = `
                <div id="re-scratch-card" style="position:relative; width:300px; height:150px; background:#fff; border-radius:10px; overflow:hidden; box-shadow:0 0 20px rgba(0,0,0,0.5);">
                    <div id="re-scratch-result" style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-family:'Cinzel',serif; font-weight:bold; font-size:1.5em; color:#333; flex-direction:column;">
                        <span style="font-size:0.6em; color:#888;">REWARD</span>
                        <span id="re-scratch-text">100 GOLD</span>
                    </div>
                    <canvas id="re-scratch-canvas" width="300" height="150" style="position:absolute; inset:0; cursor:crosshair; touch-action:none;"></canvas>
                </div>
                <button id="re-scratch-close" style="margin-top:20px; background:#cba35c; border:none; padding:8px 16px; border-radius:6px; font-weight:bold; cursor:pointer;">Collect</button>
            `;
            document.body.appendChild(modal);

            this.canvas = document.getElementById("re-scratch-canvas");
            this.ctx = this.canvas.getContext("2d");

            const start = (e) => this.scratch(e);
            const move = (e) => { if (e.buttons === 1 || e.type === "touchmove") this.scratch(e); };

            this.canvas.addEventListener("pointerdown", start);
            this.canvas.addEventListener("pointermove", move);

            document.getElementById("re-scratch-close").addEventListener("click", () => this.stop());
        }

        window.startScratchCard = (prize) => this.start(prize);
        console.log("[UIE] Scratch Card Initialized");
    }

    start(prize = "50 GOLD") {
        this.active = true;
        const modal = document.getElementById("re-scratch-modal");
        modal.style.display = "flex";
        document.getElementById("re-scratch-text").textContent = prize;

        // Reset Canvas
        this.ctx.globalCompositeOperation = "source-over";
        this.ctx.fillStyle = "#aaa"; // Silver
        this.ctx.fillRect(0, 0, this.width, this.height);

        // Add pattern/noise for realism
        this.ctx.fillStyle = "#999";
        for(let i=0; i<500; i++) {
            this.ctx.fillRect(Math.random()*this.width, Math.random()*this.height, 2, 2);
        }

        this.ctx.font = "20px monospace";
        this.ctx.fillStyle = "#666";
        this.ctx.textAlign = "center";
        this.ctx.fillText("SCRATCH HERE", this.width/2, this.height/2);
    }

    scratch(e) {
        if (!this.active) return;
        e.preventDefault();
        const rect = this.canvas.getBoundingClientRect();
        const clientX = e.clientX || e.touches[0].clientX;
        const clientY = e.clientY || e.touches[0].clientY;
        const x = clientX - rect.left;
        const y = clientY - rect.top;

        this.ctx.globalCompositeOperation = "destination-out";
        this.ctx.beginPath();
        this.ctx.arc(x, y, 15, 0, Math.PI * 2);
        this.ctx.fill();

        // Throttle check
        if (Math.random() > 0.9) this.checkProgress();
    }

    checkProgress() {
        const data = this.ctx.getImageData(0, 0, this.width, this.height).data;
        let clear = 0;
        for (let i = 3; i < data.length; i += 4) {
            if (data[i] === 0) clear++;
        }
        const pct = clear / (this.width * this.height);
        if (pct > this.threshold) {
            // Reveal all
            this.ctx.clearRect(0, 0, this.width, this.height);
            haptics.texture("success");
        }
    }

    stop() {
        this.active = false;
        document.getElementById("re-scratch-modal").style.display = "none";
        notify("success", "Reward Collected", "Scratch Card");
        // Optionally trigger command
    }
}

export const scratchCard = new ScratchCard();

export function initScratchCard() {
    scratchCard.init();
}
