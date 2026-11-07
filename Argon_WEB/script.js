/**
 * FocusFlow — Temporizador Pomodoro Avanzado & Gestor de Tareas
 * Arquitectura modular en Vanilla JavaScript (ES6+)
 */

(() => {
  "use strict";

  /* ==========================================================================
     1. CONSTANTES Y CONFIGURACIÓN POR DEFECTO
     ========================================================================== */
  const STORAGE_KEYS = {
    SETTINGS: "focusflow_settings_v1",
    THEME: "focusflow_theme_v1",
    TASKS: "focusflow_tasks_v1",
    ACTIVE_TASK: "focusflow_active_task_v1",
  };

  const DEFAULT_SETTINGS = {
    durations: {
      pomodoro: 25,
      shortBreak: 5,
      longBreak: 15,
    },
    soundEnabled: true,
    autoStart: false,
  };

  const MODE_LABELS = {
    pomodoro: "Pomodoro",
    shortBreak: "Descanso Corto",
    longBreak: "Descanso Largo",
  };

  const RING_RADIUS = 124;
  const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
  const LONG_BREAK_INTERVAL = 4; // Cada 4 Pomodoros corresponde un Descanso Largo

  /* ==========================================================================
     2. SERVICIO DE ALMACENAMIENTO LOCAL (localStorage)
     ========================================================================== */
  const StorageService = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw !== null ? JSON.parse(raw) : fallback;
      } catch (error) {
        console.warn(`No se pudo leer "${key}" desde localStorage:`, error);
        return fallback;
      }
    },

    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch (error) {
        console.warn(`No se pudo guardar "${key}" en localStorage:`, error);
      }
    },
  };

  /* ==========================================================================
     3. MOTOR DE AUDIO (Web Audio API — Sin dependencias externas)
     ========================================================================== */
  const AudioEngine = (() => {
    let audioCtx = null;

    function getContext() {
      if (!audioCtx) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) {
          audioCtx = new AudioContextClass();
        }
      }
      if (audioCtx && audioCtx.state === "suspended") {
        audioCtx.resume();
      }
      return audioCtx;
    }

    /**
     * Reproduce un acorde armónico suave estilo campana minimalista
     */
    function playAlarmChime() {
      const ctx = getContext();
      if (!ctx) return;

      const now = ctx.currentTime;
      // Notas armónicas (Do5, Mi5, Sol5, Do6)
      const frequencies = [523.25, 659.25, 783.99, 1046.5];

      frequencies.forEach((freq, index) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, now + index * 0.13);

        gain.gain.setValueAtTime(0.0001, now + index * 0.13);
        gain.gain.exponentialRampToValueAtTime(0.16, now + index * 0.13 + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.13 + 1.15);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now + index * 0.13);
        osc.stop(now + index * 0.13 + 1.2);
      });
    }

    return { playAlarmChime };
  })();

  /* ==========================================================================
     4. ESTADO GLOBAL DE LA APLICACIÓN
     ========================================================================== */
  const savedSettings = StorageService.get(STORAGE_KEYS.SETTINGS, null);
  const state = {
    settings: {
      durations: {
        ...DEFAULT_SETTINGS.durations,
        ...(savedSettings?.durations || {}),
      },
      soundEnabled: savedSettings?.soundEnabled ?? DEFAULT_SETTINGS.soundEnabled,
      autoStart: savedSettings?.autoStart ?? DEFAULT_SETTINGS.autoStart,
    },
    theme:
      StorageService.get(STORAGE_KEYS.THEME, null) ||
      (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"),

    timer: {
      mode: "pomodoro",
      isRunning: false,
      totalMs: 25 * 60 * 1000,
      remainingMs: 25 * 60 * 1000,
      targetEndTime: null,
      completedPomodoros: 0,
      intervalId: null,
      rafId: null,
    },

    tasks: StorageService.get(STORAGE_KEYS.TASKS, []),
    activeTaskId: StorageService.get(STORAGE_KEYS.ACTIVE_TASK, null),
  };

  /* ==========================================================================
     5. REFERENCIAS AL DOM
     ========================================================================== */
  const dom = {
    html: document.documentElement,
    quickThemeBtn: document.getElementById("quickThemeBtn"),
    openSettingsBtn: document.getElementById("openSettingsBtn"),
    closeSettingsBtn: document.getElementById("closeSettingsBtn"),
    settingsModal: document.getElementById("settingsModal"),
    settingsForm: document.getElementById("settingsForm"),
    restoreDefaultsBtn: document.getElementById("restoreDefaultsBtn"),

    // Inputs de configuración
    pomodoroDuration: document.getElementById("pomodoroDuration"),
    shortBreakDuration: document.getElementById("shortBreakDuration"),
    longBreakDuration: document.getElementById("longBreakDuration"),
    soundToggle: document.getElementById("soundToggle"),
    testSoundBtn: document.getElementById("testSoundBtn"),
    autoStartToggle: document.getElementById("autoStartToggle"),
    darkModeToggle: document.getElementById("darkModeToggle"),

    // Temporizador
    modeTabs: document.querySelectorAll(".mode-tab"),
    progressRingBar: document.getElementById("progressRingBar"),
    timerStatusBadge: document.getElementById("timerStatusBadge"),
    timerDisplay: document.getElementById("timerDisplay"),
    cycleCounter: document.getElementById("cycleCounter"),
    activeTaskTitle: document.getElementById("activeTaskTitle"),
    startBtn: document.getElementById("startBtn"),
    pauseBtn: document.getElementById("pauseBtn"),
    resetBtn: document.getElementById("resetBtn"),

    // Tareas
    taskForm: document.getElementById("taskForm"),
    taskInput: document.getElementById("taskInput"),
    taskEstInput: document.getElementById("taskEstInput"),
    decEstBtn: document.getElementById("decEstBtn"),
    incEstBtn: document.getElementById("incEstBtn"),
    taskList: document.getElementById("taskList"),
    emptyTasksState: document.getElementById("emptyTasksState"),
    tasksSummary: document.getElementById("tasksSummary"),
    clearCompletedBtn: document.getElementById("clearCompletedBtn"),
  };

  /* ==========================================================================
     6. GESTIÓN DE TEMA (CLARO / OSCURO)
     ========================================================================== */
  function applyTheme(theme) {
    state.theme = theme === "dark" ? "dark" : "light";
    dom.html.setAttribute("data-theme", state.theme);
    dom.darkModeToggle.checked = state.theme === "dark";
    StorageService.set(STORAGE_KEYS.THEME, state.theme);
  }

  function toggleTheme() {
    applyTheme(state.theme === "dark" ? "light" : "dark");
  }

  /* ==========================================================================
     7. MOTOR DEL TEMPORIZADOR (SIN DESAJUSTES POR SEGUNDO PLANO)
     ========================================================================== */
  function formatTime(ms) {
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function updateProgressRing() {
    const { remainingMs, totalMs } = state.timer;
    const ratio = totalMs > 0 ? Math.max(0, Math.min(1, remainingMs / totalMs)) : 0;
    const offset = RING_CIRCUMFERENCE * (1 - ratio);
    dom.progressRingBar.style.strokeDashoffset = offset.toFixed(2);
  }

  function updateTimerUI() {
    const formatted = formatTime(state.timer.remainingMs);
    const modeLabel = MODE_LABELS[state.timer.mode];

    dom.timerDisplay.textContent = formatted;
    updateProgressRing();

    // Actualizar título de la pestaña del navegador en tiempo real
    const activeTask = state.tasks.find((t) => t.id === state.activeTaskId);
    const contextLabel = activeTask && state.timer.mode === "pomodoro"
      ? activeTask.title
      : modeLabel;
    document.title = `${formatted} · ${contextLabel} — FocusFlow`;

    // Estado de los botones y badge
    dom.startBtn.disabled = state.timer.isRunning;
    dom.pauseBtn.disabled = !state.timer.isRunning;

    const startSpan = dom.startBtn.querySelector("span");
    const isPartiallyElapsed =
      !state.timer.isRunning &&
      state.timer.remainingMs < state.timer.totalMs &&
      state.timer.remainingMs > 0;
    startSpan.textContent = isPartiallyElapsed ? "Reanudar" : "Iniciar";

    if (state.timer.isRunning) {
      dom.timerStatusBadge.textContent =
        state.timer.mode === "pomodoro" ? "Enfoque activo" : "Tiempo de descanso";
    } else if (isPartiallyElapsed) {
      dom.timerStatusBadge.textContent = "En pausa";
    } else {
      dom.timerStatusBadge.textContent =
        state.timer.mode === "pomodoro" ? "Listo para enfocar" : "Listo para descansar";
    }

    dom.cycleCounter.textContent = `Sesión #${state.timer.completedPomodoros + 1} · ${state.timer.completedPomodoros} completados`;
  }

  function stopTickingLoops() {
    if (state.timer.intervalId) {
      clearInterval(state.timer.intervalId);
      state.timer.intervalId = null;
    }
    if (state.timer.rafId) {
      cancelAnimationFrame(state.timer.rafId);
      state.timer.rafId = null;
    }
  }

  /**
   * Calcula el tiempo exacto restante comparando Date.now() con targetEndTime.
   * Evita cualquier deriva temporal incluso si el navegador ralentiza pestañas ocultas.
   */
  function syncRemainingTime() {
    if (!state.timer.isRunning || !state.timer.targetEndTime) return;

    const remaining = Math.max(0, state.timer.targetEndTime - Date.now());
    state.timer.remainingMs = remaining;
    updateTimerUI();

    if (remaining <= 0) {
      handleTimerComplete();
    }
  }

  function startAnimationLoop() {
    const tick = () => {
      if (!state.timer.isRunning) return;
      syncRemainingTime();
      if (state.timer.isRunning) {
        state.timer.rafId = requestAnimationFrame(tick);
      }
    };
    state.timer.rafId = requestAnimationFrame(tick);
  }

  function startTimer() {
    if (state.timer.isRunning) return;

    if (state.timer.remainingMs <= 0) {
      state.timer.remainingMs = state.timer.totalMs;
    }

    state.timer.isRunning = true;
    state.timer.targetEndTime = Date.now() + state.timer.remainingMs;

    // Intervalo de respaldo para mantener document.title actualizado en pestañas en 2º plano
    state.timer.intervalId = setInterval(syncRemainingTime, 250);
    // requestAnimationFrame para máxima fluidez visual en primer plano
    startAnimationLoop();

    updateTimerUI();
  }

  function pauseTimer() {
    if (!state.timer.isRunning) return;

    syncRemainingTime();
    state.timer.isRunning = false;
    state.timer.targetEndTime = null;
    stopTickingLoops();
    updateTimerUI();
  }

  function resetTimer() {
    state.timer.isRunning = false;
    state.timer.targetEndTime = null;
    stopTickingLoops();

    const minutes = state.settings.durations[state.timer.mode];
    state.timer.totalMs = minutes * 60 * 1000;
    state.timer.remainingMs = state.timer.totalMs;

    updateTimerUI();
  }

  function switchMode(newMode, shouldAutoStart = false) {
    if (!MODE_LABELS[newMode]) return;

    state.timer.isRunning = false;
    state.timer.targetEndTime = null;
    stopTickingLoops();

    state.timer.mode = newMode;
    const minutes = state.settings.durations[newMode];
    state.timer.totalMs = minutes * 60 * 1000;
    state.timer.remainingMs = state.timer.totalMs;

    // Actualizar atributo de tema de acento y pestañas activas
    dom.html.setAttribute("data-mode", newMode);
    dom.modeTabs.forEach((tab) => {
      const isMatch = tab.dataset.mode === newMode;
      tab.classList.toggle("active", isMatch);
      tab.setAttribute("aria-selected", String(isMatch));
    });

    updateTimerUI();

    if (shouldAutoStart) {
      startTimer();
    }
  }

  function handleTimerComplete() {
    state.timer.isRunning = false;
    state.timer.targetEndTime = null;
    stopTickingLoops();

    if (state.settings.soundEnabled) {
      AudioEngine.playAlarmChime();
    }

    let nextMode = "pomodoro";

    if (state.timer.mode === "pomodoro") {
      state.timer.completedPomodoros += 1;
      incrementActiveTaskPomodoro();

      nextMode =
        state.timer.completedPomodoros % LONG_BREAK_INTERVAL === 0
          ? "longBreak"
          : "shortBreak";
    } else {
      nextMode = "pomodoro";
    }

    switchMode(nextMode, state.settings.autoStart);
  }

  /* ==========================================================================
     8. GESTOR DE TAREAS (TO-DO LIST INTEGRADO)
     ========================================================================== */
  function saveTasksState() {
    StorageService.set(STORAGE_KEYS.TASKS, state.tasks);
    StorageService.set(STORAGE_KEYS.ACTIVE_TASK, state.activeTaskId);
  }

  function ensureValidActiveTask() {
    const exists = state.tasks.some((t) => t.id === state.activeTaskId);
    if (!exists) {
      const firstPending = state.tasks.find((t) => !t.completed);
      state.activeTaskId = firstPending ? firstPending.id : null;
    }
  }

  function addTask(title, estPomodoros) {
    const cleanTitle = title.trim();
    if (!cleanTitle) return;

    const newTask = {
      id: typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      title: cleanTitle,
      completed: false,
      estPomodoros: Math.max(1, Math.min(20, Number(estPomodoros) || 1)),
      completedPomodoros: 0,
      createdAt: Date.now(),
    };

    state.tasks.unshift(newTask);

    // Si no hay tarea activa, activar automáticamente la recién creada
    if (!state.activeTaskId) {
      state.activeTaskId = newTask.id;
    }

    saveTasksState();
    renderTasks();
    updateTimerUI();
  }

  function toggleTaskCompleted(taskId) {
    const task = state.tasks.find((t) => t.id === taskId);
    if (!task) return;

    task.completed = !task.completed;

    // Si se completa la tarea activa, pasar el foco a la siguiente pendiente si existe
    if (task.completed && state.activeTaskId === taskId) {
      const nextPending = state.tasks.find((t) => !t.completed && t.id !== taskId);
      state.activeTaskId = nextPending ? nextPending.id : null;
    } else if (!task.completed && !state.activeTaskId) {
      state.activeTaskId = task.id;
    }

    saveTasksState();
    renderTasks();
    updateTimerUI();
  }

  function setActiveTask(taskId) {
    state.activeTaskId = state.activeTaskId === taskId ? null : taskId;
    saveTasksState();
    renderTasks();
    updateTimerUI();
  }

  function deleteTask(taskId) {
    state.tasks = state.tasks.filter((t) => t.id !== taskId);
    if (state.activeTaskId === taskId) {
      state.activeTaskId = null;
      ensureValidActiveTask();
    }
    saveTasksState();
    renderTasks();
    updateTimerUI();
  }

  function clearCompletedTasks() {
    state.tasks = state.tasks.filter((t) => !t.completed);
    ensureValidActiveTask();
    saveTasksState();
    renderTasks();
    updateTimerUI();
  }

  function incrementActiveTaskPomodoro() {
    if (!state.activeTaskId) return;
    const activeTask = state.tasks.find((t) => t.id === state.activeTaskId);
    if (activeTask) {
      activeTask.completedPomodoros += 1;
      saveTasksState();
      renderTasks();
    }
  }

  function renderTasks() {
    dom.taskList.innerHTML = "";

    const totalTasks = state.tasks.length;
    const completedCount = state.tasks.filter((t) => t.completed).length;
    const totalDonePomos = state.tasks.reduce((acc, t) => acc + t.completedPomodoros, 0);
    const totalEstPomos = state.tasks.reduce((acc, t) => acc + t.estPomodoros, 0);

    dom.tasksSummary.textContent =
      `${completedCount}/${totalTasks} completadas · ${totalDonePomos}/${totalEstPomos} pomodoros`;
    dom.clearCompletedBtn.hidden = completedCount === 0;
    dom.emptyTasksState.hidden = totalTasks > 0;

    // Actualizar banner de tarea activa en el temporizador
    const activeTask = state.tasks.find((t) => t.id === state.activeTaskId);
    dom.activeTaskTitle.textContent = activeTask
      ? activeTask.title
      : "Sin tarea seleccionada";

    // Construir elementos de lista de forma segura (prevención XSS)
    const fragment = document.createDocumentFragment();

    state.tasks.forEach((task) => {
      const isActive = task.id === state.activeTaskId;
      const li = document.createElement("li");
      li.className = "task-item";
      if (isActive) li.classList.add("is-active");
      if (task.completed) li.classList.add("is-completed");

      // 1. Botón Checkbox
      const checkBtn = document.createElement("button");
      checkBtn.type = "button";
      checkBtn.className = "task-checkbox-btn";
      checkBtn.setAttribute(
        "aria-label",
        task.completed ? "Marcar como pendiente" : "Marcar como completada"
      );
      checkBtn.innerHTML = `
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      `;
      checkBtn.addEventListener("click", () => toggleTaskCompleted(task.id));

      // 2. Cuerpo de la tarea (clic selecciona como activa)
      const bodyDiv = document.createElement("div");
      bodyDiv.className = "task-body";
      bodyDiv.title = "Haz clic para marcar esta tarea como activa";
      const nameSpan = document.createElement("span");
      nameSpan.className = "task-name";
      nameSpan.textContent = task.title;
      bodyDiv.appendChild(nameSpan);
      bodyDiv.addEventListener("click", () => setActiveTask(task.id));

      // 3. Acciones (contador pomodoros + botón Activa + botón Eliminar)
      const actionsDiv = document.createElement("div");
      actionsDiv.className = "task-actions";

      const pomoPill = document.createElement("span");
      pomoPill.className = "pomo-pill";
      pomoPill.title = "Pomodoros completados / estimados";
      pomoPill.textContent = `${task.completedPomodoros} / ${task.estPomodoros}`;

      const activeBtn = document.createElement("button");
      activeBtn.type = "button";
      activeBtn.className = "active-toggle-btn";
      activeBtn.textContent = isActive ? "Activa" : "Activar";
      activeBtn.setAttribute("aria-pressed", String(isActive));
      activeBtn.addEventListener("click", () => setActiveTask(task.id));

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "delete-task-btn";
      deleteBtn.setAttribute("aria-label", `Eliminar tarea: ${task.title}`);
      deleteBtn.title = "Eliminar tarea";
      deleteBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
      `;
      deleteBtn.addEventListener("click", () => deleteTask(task.id));

      actionsDiv.append(pomoPill, activeBtn, deleteBtn);
      li.append(checkBtn, bodyDiv, actionsDiv);
      fragment.appendChild(li);
    });

    dom.taskList.appendChild(fragment);
  }

  /* ==========================================================================
     9. PANEL DE CONFIGURACIÓN (MODAL)
     ========================================================================== */
  function populateSettingsModal() {
    dom.pomodoroDuration.value = state.settings.durations.pomodoro;
    dom.shortBreakDuration.value = state.settings.durations.shortBreak;
    dom.longBreakDuration.value = state.settings.durations.longBreak;
    dom.soundToggle.checked = state.settings.soundEnabled;
    dom.autoStartToggle.checked = state.settings.autoStart;
    dom.darkModeToggle.checked = state.theme === "dark";
  }

  function openSettingsModal() {
    populateSettingsModal();
    dom.settingsModal.hidden = false;
    dom.pomodoroDuration.focus();
  }

  function closeSettingsModal() {
    dom.settingsModal.hidden = true;
    dom.openSettingsBtn.focus();
  }

  function clampNumber(val, min, max, fallback) {
    const parsed = parseInt(val, 10);
    if (Number.isNaN(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
  }

  function handleSaveSettings(event) {
    event.preventDefault();

    const newDurations = {
      pomodoro: clampNumber(dom.pomodoroDuration.value, 1, 120, 25),
      shortBreak: clampNumber(dom.shortBreakDuration.value, 1, 60, 5),
      longBreak: clampNumber(dom.longBreakDuration.value, 1, 90, 15),
    };

    const previousModeMinutes = state.settings.durations[state.timer.mode];
    state.settings.durations = newDurations;
    state.settings.soundEnabled = dom.soundToggle.checked;
    state.settings.autoStart = dom.autoStartToggle.checked;

    StorageService.set(STORAGE_KEYS.SETTINGS, state.settings);
    applyTheme(dom.darkModeToggle.checked ? "dark" : "light");

    // Si cambió la duración del modo actual, reiniciar el reloj con el nuevo valor
    const updatedModeMinutes = newDurations[state.timer.mode];
    if (previousModeMinutes !== updatedModeMinutes) {
      resetTimer();
    } else {
      updateTimerUI();
    }

    closeSettingsModal();
  }

  function handleRestoreDefaults() {
    dom.pomodoroDuration.value = DEFAULT_SETTINGS.durations.pomodoro;
    dom.shortBreakDuration.value = DEFAULT_SETTINGS.durations.shortBreak;
    dom.longBreakDuration.value = DEFAULT_SETTINGS.durations.longBreak;
    dom.soundToggle.checked = DEFAULT_SETTINGS.soundEnabled;
    dom.autoStartToggle.checked = DEFAULT_SETTINGS.autoStart;
  }

  /* ==========================================================================
     10. EVENT LISTENERS E INICIALIZACIÓN
     ========================================================================== */
  function bindEvents() {
    // Controles del Temporizador
    dom.startBtn.addEventListener("click", startTimer);
    dom.pauseBtn.addEventListener("click", pauseTimer);
    dom.resetBtn.addEventListener("click", resetTimer);

    // Pestañas de modo
    dom.modeTabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        const targetMode = tab.dataset.mode;
        if (targetMode !== state.timer.mode) {
          switchMode(targetMode, false);
        }
      });
    });

    // Tema rápido en cabecera y switch en modal
    dom.quickThemeBtn.addEventListener("click", toggleTheme);
    dom.darkModeToggle.addEventListener("change", (e) => {
      applyTheme(e.target.checked ? "dark" : "light");
    });

    // Modal de Configuración
    dom.openSettingsBtn.addEventListener("click", openSettingsModal);
    dom.closeSettingsBtn.addEventListener("click", closeSettingsModal);
    dom.settingsModal.addEventListener("click", (e) => {
      if (e.target === dom.settingsModal) closeSettingsModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !dom.settingsModal.hidden) {
        closeSettingsModal();
      }
    });
    dom.settingsForm.addEventListener("submit", handleSaveSettings);
    dom.restoreDefaultsBtn.addEventListener("click", handleRestoreDefaults);
    dom.testSoundBtn.addEventListener("click", () => AudioEngine.playAlarmChime());

    // Sincronizar al volver la pestaña a primer plano
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && state.timer.isRunning) {
        syncRemainingTime();
      }
    });

    // Controles del formulario de Tareas
    dom.decEstBtn.addEventListener("click", () => {
      const current = parseInt(dom.taskEstInput.value, 10) || 1;
      dom.taskEstInput.value = Math.max(1, current - 1);
    });

    dom.incEstBtn.addEventListener("click", () => {
      const current = parseInt(dom.taskEstInput.value, 10) || 1;
      dom.taskEstInput.value = Math.min(20, current + 1);
    });

    dom.taskForm.addEventListener("submit", (e) => {
      e.preventDefault();
      addTask(dom.taskInput.value, dom.taskEstInput.value);
      dom.taskInput.value = "";
      dom.taskEstInput.value = "1";
      dom.taskInput.focus();
    });

    dom.clearCompletedBtn.addEventListener("click", clearCompletedTasks);
  }

  function init() {
    // Configurar perímetro inicial del anillo SVG
    dom.progressRingBar.style.strokeDasharray = RING_CIRCUMFERENCE.toFixed(2);
    dom.progressRingBar.style.strokeDashoffset = "0";

    // Aplicar tema guardado
    applyTheme(state.theme);

    // Configurar duración inicial desde ajustes guardados
    const initialMinutes = state.settings.durations[state.timer.mode];
    state.timer.totalMs = initialMinutes * 60 * 1000;
    state.timer.remainingMs = state.timer.totalMs;

    // Validar tarea activa y renderizar interfaz
    ensureValidActiveTask();
    renderTasks();
    updateTimerUI();
    bindEvents();
  }

  init();
})();
