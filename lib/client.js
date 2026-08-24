window.__ModuleLoader__.load({
	id: 'dsh-schedule-ui',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		var react = require('react');
		const React = react;
		var react_dom = require('react-dom');
		let createRoot = react_dom.createRoot;
		if (createRoot === undefined) {
			try { createRoot = require('react-dom/client').createRoot; } catch {}
		}

		// ==== 定时任务：管理面板 + 侧边栏分区（持久化版）====
		// 会话头部「定时任务」按钮 + shell.overlay 全局浮层 + 侧边栏「定时任务」分区。
		// 经 HTTP 路由（/dsh-schedule-ui/*）读写 schedule/change 事件流，
		// 与模型工具 schedule_create / schedule_list / schedule_delete 共享同一份数据。
		// 视觉风格使用程序自身的 --dsw-alias-* 设计 token。

		const rpc = async (method, args) => {
			try {
				const res = await fetch('/dsh-schedule-ui/' + method, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(args),
				});
				if (!res.ok) return { ok: false, message: 'HTTP ' + res.status };
				try { return await res.json(); } catch { return { ok: false, message: '响应格式错误' }; }
			} catch { return { ok: false, message: '网络错误' }; }
		};

		const inject = ['slots', 'sessions'];

		function apply(ctx) {
			const slots = ctx.slots;

			// ---- 共享浮层状态（按钮 / 面板 / 侧边栏分区分属不同 Slot 或 DOM 注入，经模块级 store 联动）----
			const store = { open: false, sessionId: null, revision: 0, listeners: new Set() };
			const emit = () => { for (const fn of store.listeners) fn(); };
			const openPanel = (sessionId) => { store.sessionId = sessionId; store.open = true; emit(); };
			const closePanel = () => { store.open = false; emit(); };
			const notifyPanelChanged = () => { store.revision += 1; emit(); };
			const useStore = () => {
				const [, force] = React.useState(0);
				React.useEffect(() => {
					const fn = () => force((x) => x + 1);
					store.listeners.add(fn);
					return () => store.listeners.delete(fn);
				}, []);
				return store;
			};

			const h = React.createElement;

			// ---- 小工具 ----
			const fmtTime = (iso) => {
				try { return new Date(iso).toLocaleString(); } catch { return iso; }
			};
			const kindLabel = (kind) => kind === 'after' ? '延时' : kind === 'at' ? '定时' : '周期';
			const kindMeta = (r) => {
				if (r.kind === 'at') return '于 ' + fmtTime(r.scheduledAt);
				if (r.kind === 'after') return r.afterSeconds + ' 秒后 · ' + fmtTime(r.scheduledAt);
				const minutes = r.everySeconds / 60;
				const every = Number.isInteger(minutes) ? '每 ' + minutes + ' 分钟' : '每 ' + r.everySeconds + ' 秒';
				return every + ' · 下次 ' + fmtTime(r.scheduledAt);
			};

			// ---- 头部按钮 ----
			function ScheduleButton(props) {
				return h('button', {
					className: 'sui-open',
					title: '定时任务',
					onClick: () => props.onOpen(props.sessionId),
				},
					h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '2', strokeLinecap: 'round', strokeLinejoin: 'round', width: 14, height: 14 },
						h('circle', { cx: '12', cy: '12', r: '9' }),
						h('path', { d: 'M12 7v5l3 2' }),
					),
					h('span', null, '定时任务'),
				);
			}

			// ---- 浮层面板 ----
			function SchedulePanel(props) {
				const { sessionId, onClose } = props;
				const [records, setRecords] = React.useState(null);
				const [error, setError] = React.useState(null);
				const [notice, setNotice] = React.useState(null);
				const [prompt, setPrompt] = React.useState('');
				const [mode, setMode] = React.useState('after');
				const [afterSec, setAfterSec] = React.useState(60);
				const [atValue, setAtValue] = React.useState('');
				const [tz, setTz] = React.useState(() => {
					try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return 'UTC'; }
				});
				const [everyMin, setEveryMin] = React.useState(60);
				const [busy, setBusy] = React.useState(false);

				const refresh = React.useCallback(async () => {
					setError(null);
					const res = await rpc('list', { sessionId });
					if (res && res.ok === true) { setRecords(res.records); notifyPanelChanged(); }
					else setError((res && res.message) || '无法加载定时任务');
				}, [sessionId]);

				React.useEffect(() => { refresh(); }, [refresh]);

				const submit = async () => {
					if (prompt.trim().length === 0) { setError('请输入任务内容'); return; }
					let args = { sessionId, prompt: prompt.trim() };
					if (mode === 'after') {
						if (!Number.isSafeInteger(afterSec) || afterSec <= 0) { setError('延时秒数需为正整数'); return; }
						args.after_seconds = afterSec;
					} else if (mode === 'at') {
						if (!atValue || !atValue.includes('T')) { setError('请选择定时时间'); return; }
						const [date, time] = atValue.split('T');
						args.at = { date, time: time + ':00', time_zone: tz };
					} else {
						if (!Number.isSafeInteger(everyMin) || everyMin < 5) { setError('周期至少为 5 分钟'); return; }
						args.every_seconds = everyMin * 60;
					}
					setBusy(true); setError(null); setNotice(null);
					try {
						const res = await rpc('create', args);
						if (res && res.ok === true) { setPrompt(''); setNotice('已创建定时任务'); await refresh(); }
						else setError((res && res.message) || '创建失败');
					} catch { setError('创建失败'); } finally { setBusy(false); }
				};

				const remove = async (id) => {
					setError(null);
					const res = await rpc('delete', { sessionId, id });
					if (res && res.ok === true) await refresh();
					else setError((res && res.message) || '删除失败');
				};

				const field = (label, value, onChange, placeholder, type = 'text', min) =>
					h('input', {
						className: 'sui-input', type, min, value, placeholder,
						onChange: (e) => onChange(type === 'number' ? Number(e.target.value) : e.target.value),
					});

				const modeBtn = (m, label) => h('button', {
					className: 'sui-mode' + (mode === m ? ' sui-mode-on' : ''),
					onClick: () => setMode(m),
				}, label);

				return h('div', { className: 'sui-mask' },
					h('div', { className: 'sui-mask-bg', onClick: onClose }),
					h('div', { className: 'sui-panel' },
						h('div', { className: 'sui-panel-head' },
							h('div', null,
								h('div', { className: 'sui-panel-title' }, '定时任务'),
								h('div', { className: 'sui-panel-sub' }, '到点后以会话内消息递送，与本会话的 agent 工具共享同一份任务列表'),
							),
							h('button', { className: 'sui-close', title: '关闭', onClick: onClose },
								h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '2', strokeLinecap: 'round', width: 16, height: 16 },
									h('path', { d: 'M6 6l12 12M18 6L6 18' }),
								),
							),
						),
						h('div', { className: 'sui-body' },
							h('div', { className: 'sui-card' },
								h('div', { className: 'sui-card-title' }, '新建任务'),
								h('textarea', {
									className: 'sui-input sui-area', rows: 3, value: prompt,
									placeholder: '任务内容（自包含描述：检查范围、输出格式、边界）…',
									onChange: (e) => setPrompt(e.target.value),
								}),
								h('div', { className: 'sui-modes' },
									modeBtn('after', '延时'),
									modeBtn('at', '定时'),
									modeBtn('every', '周期'),
								),
								mode === 'after' && h('div', { className: 'sui-row' },
									h('span', { className: 'sui-row-label' }, '秒数'),
									field('', afterSec, setAfterSec, '例如 60', 'number', 1),
								),
								mode === 'at' && h('div', { className: 'sui-row' },
									h('span', { className: 'sui-row-label' }, '时间'),
									field('', atValue, setAtValue, '', 'datetime-local'),
								),
								mode === 'at' && h('div', { className: 'sui-row' },
									h('span', { className: 'sui-row-label' }, '时区'),
									field('', tz, setTz, 'Asia/Shanghai'),
								),
								mode === 'every' && h('div', { className: 'sui-row' },
									h('span', { className: 'sui-row-label' }, '间隔（分钟）'),
									field('', everyMin, setEveryMin, '≥ 5', 'number', 5),
								),
								h('div', { className: 'sui-actions' },
									error && h('div', { className: 'sui-error' }, error),
									notice && h('div', { className: 'sui-notice' }, notice),
									h('button', { className: 'sui-btn sui-btn-primary', disabled: busy, onClick: submit },
										busy ? '创建中…' : '创建任务'),
								),
							),
							h('div', { className: 'sui-list' },
								h('div', { className: 'sui-list-head' },
									h('span', null, '任务列表'),
									records && records.length > 0 && h('span', { className: 'sui-count' }, records.length),
								),
								records === null && h('div', { className: 'sui-empty' }, '加载中…'),
								records !== null && records.length === 0 && h('div', { className: 'sui-empty' }, '暂无定时任务，在上方创建一个'),
								records !== null && records.map((r) =>
									h('div', { className: 'sui-task', key: r.id },
										h('div', { className: 'sui-task-main' },
											h('div', { className: 'sui-task-top' },
												h('span', { className: 'sui-kind' }, kindLabel(r.kind)),
												h('span', { className: 'sui-badge' + (r.state === 'overdue' ? ' sui-badge-warn' : '') },
													r.state === 'overdue' ? '已到期' : '待执行'),
											),
											h('div', { className: 'sui-task-prompt' }, r.prompt),
											h('div', { className: 'sui-task-meta' }, kindMeta(r)),
										),
										h('button', {
											className: 'sui-del', title: '删除',
											onClick: () => remove(r.id),
										},
											h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '2', strokeLinecap: 'round', width: 14, height: 14 },
												h('path', { d: 'M6 6l12 12M18 6L6 18' }),
											),
										),
									),
								),
							),
						),
					),
				);
			}

			// ---- 侧边栏分区（当前会话的定时任务）----
			// 官方 sidebar.workspaces 是单占位 slot、已被 ui-workspace 占用，没有给第三方
			// 插件提供「与工作区同级」的注册点；按生态惯例（dsh-task-board / dsh-ssh），
			// 在 New Session 按钮与工作区浏览器之间注入自愈式 DOM 区块，
			// 分区内容用独立 React root 渲染，不干扰外壳的协调器。

			function ScheduleSidebarSection(props) {
				const { sessions, store } = props;
				const [currentId, setCurrentId] = React.useState(() => sessions.list.getSnapshot().current);
				const [records, setRecords] = React.useState(null);
				const [error, setError] = React.useState(null);
				const [expanded, setExpanded] = React.useState(true);
				const [revision, setRevision] = React.useState(0);
				const ownerRef = React.useRef(null);

				React.useEffect(() => {
					const sync = () => setCurrentId(sessions.list.getSnapshot().current);
					const dispose = sessions.list.subscribe(sync);
					sync();
					return dispose;
				}, [sessions]);

				React.useEffect(() => {
					const fn = () => setRevision((x) => x + 1);
					store.listeners.add(fn);
					return () => store.listeners.delete(fn);
				}, [store]);

				React.useEffect(() => {
					if (!currentId) { setRecords(null); setError(null); return; }
					let alive = true;
					const load = async () => {
						const res = await rpc('list', { sessionId: currentId });
						if (!alive) return;
						if (res && res.ok === true) { setRecords(res.records); ownerRef.current = currentId; setError(null); }
						else setError((res && res.message) || '加载失败');
					};
					load();
					return () => { alive = false; };
				}, [currentId, revision]);

				const toggle = (e) => {
					const rail = e.currentTarget.closest('[class*="collapsed"]');
					if (rail) {
						const id = sessions.list.getSnapshot().current;
						if (id) openPanel(id);
						return;
					}
					setExpanded((x) => !x);
				};
				const openOwner = () => {
					if (ownerRef.current) sessions.open(ownerRef.current);
				};

				const clockIcon = h('svg', { viewBox: '0 0 16 16', width: 14, height: 14, fill: 'none', stroke: 'currentColor', strokeWidth: '1.4', strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
					h('circle', { cx: '8', cy: '8', r: '6' }),
					h('path', { d: 'M8 5v3l2 1.4' }),
				);
				const chevronIcon = h('svg', { viewBox: '0 0 16 16', width: 12, height: 12, fill: 'none', stroke: 'currentColor', strokeWidth: '1.6', strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
					h('path', { d: 'M6 3.5L10.5 8 6 12.5' }),
				);

				return h('div', { className: 'sui-sidebar' },
					h('button', { type: 'button', className: 'sui-sidebar-head', title: '定时任务', onClick: toggle, 'aria-expanded': expanded ? 'true' : 'false' },
						h('span', { className: 'sui-sidebar-icon' }, clockIcon),
						h('span', { className: 'sui-sidebar-label' }, '定时任务'),
						records !== null && records.length > 0 && h('span', { className: 'sui-sidebar-count' }, records.length),
						h('span', { className: 'sui-sidebar-chevron' + (expanded ? ' sui-sidebar-chevron-open' : '') }, chevronIcon),
					),
					expanded && h('div', { className: 'sui-sidebar-list' },
						!currentId && h('div', { className: 'sui-sidebar-empty' }, '当前无会话'),
						currentId && error && h('div', { className: 'sui-sidebar-empty' }, error),
						currentId && !error && records === null && h('div', { className: 'sui-sidebar-empty' }, '加载中…'),
						currentId && !error && records !== null && records.length === 0 && h('div', { className: 'sui-sidebar-empty' }, '暂无定时任务'),
						currentId && !error && records !== null && records.map((r) =>
							h('button', { type: 'button', key: r.id, className: 'sui-sidebar-task', title: '打开所属会话', onClick: openOwner },
								h('span', { className: 'sui-sidebar-task-kind' }, kindLabel(r.kind)),
								h('span', { className: 'sui-sidebar-task-main' },
									h('span', { className: 'sui-sidebar-task-prompt' }, r.prompt),
									h('span', { className: 'sui-sidebar-task-meta' }, kindMeta(r)),
								),
								h('span', { className: 'sui-sidebar-task-dot' + (r.state === 'overdue' ? ' sui-sidebar-task-dot-warn' : '') }),
							),
						),
					),
				);
			}

			// 自愈式注入：等待侧边栏外壳渲染后，在 New Session 按钮与工作区浏览器之间
			// 插入分区容器；React 重渲染挤掉该节点时由 MutationObserver 同帧恢复。
			function mountSidebarSection() {
				const SEL = '[data-dsh-schedule-section]';
				if (document.querySelector(SEL) !== null) return () => {};

				const container = document.createElement('div');
				container.className = 'sui-sidebar';
				container.setAttribute('data-dsh-schedule-section', '');

				let reactRoot = null;
				let host = null;

				const place = () => {
					if (container.isConnected) return true;
					const column = document.querySelector('[data-pane="sidebar"], [class*="sidebarCol"]');
					if (column === null) return false;
					const logoRow = column.querySelector('[class*="logoRow"]');
					const root = (logoRow !== null && logoRow.parentElement !== null) ? logoRow.parentElement : column.firstElementChild;
					if (root === null || !(root instanceof HTMLElement)) return false;
					const anchor = (logoRow !== null && logoRow.parentElement === root) ? logoRow.nextSibling : (root.children[1] || null);
					root.insertBefore(container, anchor);
					host = root;
					if (reactRoot === null) {
						reactRoot = createRoot(container);
						reactRoot.render(h(ScheduleSidebarSection, { sessions: ctx.sessions, store }));
					}
					return true;
				};

				const bodyObserver = new MutationObserver(() => { place(); });
				bodyObserver.observe(document.body, { childList: true, subtree: true });

				const hostObserver = new MutationObserver(() => {
					if (host === null || !host.isConnected) { host = null; place(); return; }
					if (!host.contains(container)) place();
				});

				const tryPlace = () => {
					if (place()) hostObserver.observe(host, { childList: true, subtree: true });
				};
				tryPlace();

				return () => {
					bodyObserver.disconnect();
					hostObserver.disconnect();
					if (reactRoot !== null) reactRoot.unmount();
					container.remove();
				};
			}

			mountSidebarSection();

			// ---- Slot 注册 ----
			slots.inject('conversation.session.header.actions', () => slots.register(
				{ name: 'conversation.session.header.actions', id: 'schedule-ui.open', order: 30, label: () => '定时任务' },
				(p) => h(ScheduleButton, { sessionId: p.sessionId, onOpen: openPanel }),
			));
			slots.inject('shell.overlay', () => slots.register(
				{ name: 'shell.overlay', id: 'schedule-ui.panel', order: 50 },
				() => {
					const s = useStore();
					if (!s.open || !s.sessionId) return null;
					return h(SchedulePanel, { sessionId: s.sessionId, onClose: closePanel });
				},
			));
		}

		// ---- 样式（使用程序自身的 --dsw-alias-* 设计 token）----
		if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="dsh-schedule-ui"]') === null) {
			const tag = document.createElement('style');
			tag.dataset.plugin = 'dsh-schedule-ui';
			tag.dataset.pluginCss = 'dsh-schedule-ui';
			tag.textContent = [
				'.sui-open{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border:none;border-radius:14px;background:var(--dsw-alias-button-tool-bar-fill);color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;cursor:pointer}',
				'.sui-open:hover{background:var(--dsw-alias-button-tool-bar-hover)}',
				'.sui-mask{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:24px}',
				'.sui-mask-bg{position:absolute;inset:0;background:var(--dsw-alias-bg-mask-1);-webkit-backdrop-filter:var(--dsw-mask-blur);backdrop-filter:var(--dsw-mask-blur)}',
				'.sui-panel{position:relative;z-index:1;display:flex;flex-direction:column;width:min(600px,100%);max-height:84vh;overflow:hidden;border:1px solid var(--dsw-alias-border-l2);border-radius:16px;background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-shadow-lv3)}',
				'.sui-panel-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 20px;border-bottom:1px solid var(--dsw-alias-border-l1)}',
				'.sui-panel-title{font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary)}',
				'.sui-panel-sub{font-size:12px;color:var(--dsw-alias-label-tertiary);margin-top:2px}',
				'.sui-close{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:none;border-radius:50%;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}',
				'.sui-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
				'.sui-body{padding:20px;overflow-y:auto;display:flex;flex-direction:column;gap:16px}',
				'.sui-card{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-2);padding:14px;display:flex;flex-direction:column;gap:10px}',
				'.sui-card-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}',
				'.sui-input{width:100%;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;padding:8px 10px;outline:none}',
				'.sui-input:focus{border-color:var(--dsw-alias-brand-primary)}',
				'.sui-input::placeholder{color:var(--dsw-alias-label-dimmed)}',
				'.sui-area{resize:vertical;min-height:64px}',
				'.sui-modes{display:inline-flex;gap:4px;padding:3px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);align-self:flex-start}',
				'.sui-mode{border:none;background:transparent;border-radius:7px;padding:4px 12px;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer}',
				'.sui-mode-on{background:var(--dsw-alias-button-tool-bar-fill);color:var(--dsw-alias-label-primary)}',
				'.sui-row{display:flex;align-items:center;gap:10px}',
				'.sui-row-label{font-size:12px;color:var(--dsw-alias-label-secondary);width:64px;flex:none}',
				'.sui-row .sui-input{width:auto;flex:1}',
				'.sui-actions{display:flex;align-items:center;gap:10px;margin-top:2px}',
				'.sui-error{font-size:12px;color:var(--dsw-alias-state-error-primary)}',
				'.sui-notice{font-size:12px;color:var(--dsw-alias-state-success-primary)}',
				'.sui-btn{display:inline-flex;align-items:center;justify-content:center;gap:4px;border:none;border-radius:14px;cursor:pointer;font-size:13px;line-height:20px;padding:0 14px;height:28px}',
				'.sui-btn:disabled{cursor:not-allowed;opacity:.4}',
				'.sui-btn-primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}',
				'.sui-btn-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}',
				'.sui-list{display:flex;flex-direction:column;gap:8px}',
				'.sui-list-head{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}',
				'.sui-count{font-size:11px;font-weight:500;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:0 6px;line-height:16px}',
				'.sui-empty{font-size:12px;color:var(--dsw-alias-label-tertiary);text-align:center;padding:18px 0}',
				'.sui-task{display:flex;align-items:flex-start;gap:10px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-2);padding:12px 14px}',
				'.sui-task-main{flex:1;min-width:0}',
				'.sui-task-top{display:flex;align-items:center;gap:8px}',
				'.sui-kind{font-size:11px;color:var(--dsw-alias-label-tertiary);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:0 6px;line-height:16px}',
				'.sui-badge{font-size:11px;line-height:16px;border-radius:6px;padding:0 6px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1)}',
				'.sui-badge-warn{color:var(--dsw-alias-state-warn-label);border-color:var(--dsw-alias-state-warn-primary);background:var(--dsw-alias-bg-layer-1)}',
				'.sui-task-prompt{font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);margin-top:6px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-all}',
				'.sui-task-meta{font-size:12px;color:var(--dsw-alias-label-tertiary);margin-top:4px}',
				'.sui-del{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;flex:none;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}',
				'.sui-del:hover{background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary)}',
				// ---- 侧边栏分区 ----
				'.sui-sidebar{box-sizing:border-box;width:100%;margin:2px 0 4px}',
				'.sui-sidebar-head{display:flex;align-items:center;gap:8px;box-sizing:border-box;width:100%;height:34px;padding:0 8px;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;cursor:pointer;text-align:left}',
				'.sui-sidebar-head:hover{background:var(--dsw-specific-sidebar-nav-item-hover)}',
				'.sui-sidebar-icon{display:inline-flex;align-items:center;justify-content:center;flex:none;color:var(--dsw-alias-label-secondary)}',
				'.sui-sidebar-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}',
				'.sui-sidebar-count{flex:none;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:0 6px}',
				'.sui-sidebar-chevron{display:inline-flex;align-items:center;justify-content:center;flex:none;color:var(--dsw-alias-label-tertiary);transform:rotate(0deg);transition:transform .15s ease}',
				'.sui-sidebar-chevron-open{transform:rotate(90deg)}',
				'.sui-sidebar-list{display:flex;flex-direction:column;gap:2px;margin:2px 0 6px;max-height:min(40vh,320px);overflow-y:auto}',
				'.sui-sidebar-task{display:flex;align-items:center;gap:8px;box-sizing:border-box;width:100%;min-height:34px;padding:5px 8px;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;cursor:pointer;text-align:left}',
				'.sui-sidebar-task:hover{background:var(--dsw-specific-sidebar-nav-item-hover)}',
				'.sui-sidebar-task-kind{flex:none;font-size:10px;line-height:16px;color:var(--dsw-alias-label-tertiary);border:1px solid var(--dsw-alias-border-l1);border-radius:5px;padding:0 5px}',
				'.sui-sidebar-task-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}',
				'.sui-sidebar-task-prompt{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-all}',
				'.sui-sidebar-task-meta{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}',
				'.sui-sidebar-task-dot{flex:none;width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-label-tertiary);opacity:.45}',
				'.sui-sidebar-task-dot-warn{background:var(--dsw-alias-state-warn-primary);opacity:1}',
				'.sui-sidebar-empty{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);padding:6px 10px}',
				'[class*="collapsed"] > .sui-sidebar .sui-sidebar-head{justify-content:center;padding:0;width:100%;height:36px;border-radius:10px}',
				'[class*="collapsed"] > .sui-sidebar .sui-sidebar-label,[class*="collapsed"] > .sui-sidebar .sui-sidebar-count,[class*="collapsed"] > .sui-sidebar .sui-sidebar-chevron{display:none}',
				'[class*="collapsed"] > .sui-sidebar .sui-sidebar-list{display:none}',
			].join('\n');
			document.head.appendChild(tag);
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
