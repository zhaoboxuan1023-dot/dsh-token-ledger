window.__ModuleLoader__.load({
	id: "dsh-token-ledger",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const react = require("react");
		const jsx = require("react/jsx-runtime");

		const ENDPOINT = "/plugins/token-ledger/summary";
		const POLL_MS = 5000;
		const STYLE_ID = "dsh-token-ledger/style";

		/** Compact a token count for a narrow pill. */
		function compact(value) {
			if (value >= 1e9) return (value / 1e9).toFixed(2) + "B";
			if (value >= 1e6) return (value / 1e6).toFixed(2) + "M";
			if (value >= 1e3) return (value / 1e3).toFixed(1) + "K";
			return String(value);
		}

		/** Render an exact count with thousands separators. */
		function exact(value) {
			return value.toLocaleString("en-US");
		}

		/** Share one stylesheet across every mount of this plugin. */
		function ensureStyle() {
			if (typeof document === "undefined") return;
			if (document.querySelector('style[data-plugin="dsh-token-ledger"]') !== null) return;
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-token-ledger";
			tag.id = STYLE_ID;
			tag.textContent = [
				".tl-anchor{position:relative;display:inline-flex;align-items:center}",
				".tl-pill{display:inline-flex;align-items:center;gap:6px;border:0;background:transparent;color:inherit;font:inherit;font-size:12px;line-height:18px;padding:2px 6px;border-radius:6px;cursor:pointer;opacity:.72}",
				".tl-pill:hover,.tl-pill[aria-expanded='true']{opacity:1;background:var(--dsw-alias-fill-tertiary, rgba(127,127,127,.12))}",
				".tl-panel{position:absolute;bottom:calc(100% + 8px);left:0;z-index:60;width:380px;max-height:60vh;overflow:auto;padding:12px;border-radius:12px;background:var(--dsw-alias-bg-layer-1,#1f1f1f);border:1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.12));box-shadow:0 8px 28px rgba(0,0,0,.32);font-size:12px;line-height:18px}",
				".tl-head{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px}",
				".tl-title{font-weight:600}",
				".tl-sub{opacity:.6;font-size:11px}",
				".tl-grid{display:grid;grid-template-columns:auto 1fr;gap:2px 12px;margin:0 0 10px}",
				".tl-grid dt{opacity:.6}",
				".tl-grid dd{margin:0;text-align:right;font-variant-numeric:tabular-nums}",
				".tl-section{margin-top:10px;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.08))}",
				".tl-section h4{margin:0 0 6px;font-size:11px;font-weight:600;opacity:.6}",
				".tl-row{display:flex;justify-content:space-between;gap:8px;padding:1px 0}",
				".tl-row span:last-child{font-variant-numeric:tabular-nums;opacity:.85}",
				".tl-err{padding:4px 0;opacity:.7}",
			].join("");
			document.head.appendChild(tag);
		}

		/** Poll the host summary while the pill is mounted. */
		function useLedger() {
			const [state, setState] = react.useState({ status: "loading" });
			react.useEffect(() => {
				let alive = true;
				const controller = new AbortController();
				const load = async () => {
					try {
						const response = await fetch(ENDPOINT, { signal: controller.signal, headers: { accept: "application/json" } });
						if (!response.ok) throw new Error("HTTP " + response.status);
						const data = await response.json();
						if (alive) setState({ status: "ready", data });
					} catch (error) {
						if (alive && String(error).indexOf("AbortError") === -1) setState({ status: "error", error: String(error) });
					}
				};
				load();
				const timer = window.setInterval(load, POLL_MS);
				return () => {
					alive = false;
					controller.abort();
					window.clearInterval(timer);
				};
			}, []);
			return state;
		}

		/** One labelled usage row. */
		function Row({ label, value }) {
			return jsx.jsxs("div", { className: "tl-row", children: [
				jsx.jsx("span", { children: label }),
				jsx.jsx("span", { children: value }),
			] });
		}

		/** The expandable ledger panel. */
		function Panel({ data }) {
			const totals = data.totals;
			const providers = Object.entries(data.byProvider).sort((a, b) => b[1].input + b[1].cacheRead + b[1].output - (a[1].input + a[1].cacheRead + a[1].output));
			const models = Object.entries(data.byModel).sort((a, b) => b[1].input + b[1].cacheRead + b[1].output - (a[1].input + a[1].cacheRead + a[1].output));
			const days = Object.entries(data.byDay).sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 7);
			const cacheHit = totals.input + totals.cacheRead + totals.cacheWrite === 0 ? 0 : (totals.cacheRead / (totals.input + totals.cacheRead + totals.cacheWrite)) * 100;
			return jsx.jsxs("div", { className: "tl-panel", role: "dialog", "aria-label": "Token 用量", children: [
				jsx.jsxs("div", { className: "tl-head", children: [
					jsx.jsx("span", { className: "tl-title", children: "Token 用量" }),
					jsx.jsx("span", { className: "tl-sub", children: data.sessions + " 个会话 · " + totals.requests + " 次请求" }),
				] }),
				jsx.jsxs("dl", { className: "tl-grid", children: [
					jsx.jsx("dt", { children: "计费合计" }), jsx.jsx("dd", { children: exact(totals.billed) }),
					jsx.jsx("dt", { children: "未缓存输入" }), jsx.jsx("dd", { children: exact(totals.input) }),
					jsx.jsx("dt", { children: "缓存读取" }), jsx.jsx("dd", { children: exact(totals.cacheRead) }),
					totals.cacheWrite > 0 ? jsx.jsx("dt", { children: "缓存写入" }) : null,
					totals.cacheWrite > 0 ? jsx.jsx("dd", { children: exact(totals.cacheWrite) }) : null,
					jsx.jsx("dt", { children: "输出" }), jsx.jsx("dd", { children: exact(totals.output) }),
					jsx.jsx("dt", { children: "缓存命中率" }), jsx.jsx("dd", { children: cacheHit.toFixed(1) + "%" }),
				] }),
				jsx.jsxs("div", { className: "tl-section", children: [
					jsx.jsx("h4", { children: "按通道" }),
					providers.map(([key, value]) => jsx.jsx(Row, {
						label: key,
						value: exact(value.input + value.cacheRead + value.cacheWrite + value.output),
					}, key)),
				] }),
				jsx.jsxs("div", { className: "tl-section", children: [
					jsx.jsx("h4", { children: "按模型" }),
					models.slice(0, 8).map(([key, value]) => jsx.jsx(Row, {
						label: key,
						value: exact(value.input + value.cacheRead + value.cacheWrite + value.output),
					}, key)),
				] }),
				data.unmetered > 0 ? jsx.jsxs("div", { className: "tl-section", children: [
					jsx.jsx("h4", { children: "未计量" }),
					jsx.jsx(Row, { label: data.unmetered + " 条回复未回传用量", value: "未计入" }),
				] }) : null,
				jsx.jsxs("div", { className: "tl-section", children: [
					jsx.jsx("h4", { children: "最近几天" }),
					days.map(([day, value]) => jsx.jsx(Row, {
						label: day,
						value: exact(value.input + value.cacheRead + value.cacheWrite + value.output),
					}, day)),
				] }),
			] });
		}

		/** The composer pill and its panel. */
		function LedgerPill() {
			const state = useLedger();
			const [open, setOpen] = react.useState(false);
			const rootRef = react.useRef(null);
			react.useEffect(() => {
				ensureStyle();
			}, []);
			react.useEffect(() => {
				if (!open) return;
				const onPointer = (event) => {
					if (rootRef.current !== null && !rootRef.current.contains(event.target)) setOpen(false);
				};
				const onKey = (event) => {
					if (event.key === "Escape") setOpen(false);
				};
				document.addEventListener("pointerdown", onPointer);
				document.addEventListener("keydown", onKey);
				return () => {
					document.removeEventListener("pointerdown", onPointer);
					document.removeEventListener("keydown", onKey);
				};
			}, [open]);
			const label = state.status === "ready" ? compact(state.data.totals.billed) + " tok" : state.status === "error" ? "用量不可用" : "用量 …";
			return jsx.jsxs("span", { ref: rootRef, className: "tl-anchor", children: [
				jsx.jsxs("button", {
					type: "button",
					className: "tl-pill",
					"aria-haspopup": "dialog",
					"aria-expanded": open,
					"aria-label": "Token 用量：" + label,
					onClick: () => setOpen(!open),
					children: [jsx.jsx("span", { children: "用量" }), jsx.jsx("span", { children: label })],
				}),
				open && state.status === "ready" ? jsx.jsx(Panel, { data: state.data }) : null,
				open && state.status === "error" ? jsx.jsx("div", { className: "tl-panel", children: jsx.jsx("div", { className: "tl-err", children: "无法读取用量：" + state.error }) }) : null,
			] });
		}

		const inject = ["slots"];

		function apply(ctx) {
			ctx.slots.inject("conversation.composer.dock", () =>
				ctx.slots.register({ name: "conversation.composer.dock", id: "token-ledger", order: 2 }, LedgerPill),
			);
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
