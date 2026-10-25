import {
  escapeHtml as e,
  basename,
  dirname,
  byteSize,
  timeLabel,
  nodeLabel,
  describeNode,
} from "./core.mjs";
import { icon, nodeIcon } from "../lib/icons.mjs";
import { LANGUAGES, JAVA_FILE_TEMPLATES, SHORTCUTS } from "./language.mjs";
import { diffLines } from "../lib/diff.mjs";

export const glyph = (name, size = 17) => icon(name, "", size);
export const button = (
  action,
  label,
  name,
  className = "ide-button",
  attributes = "",
) =>
  `<button class="${className}" data-action="${action}" ${attributes}>${name ? glyph(name) : ""}<span>${e(label)}</span></button>`;
export const iconButton = (action, label, name, attributes = "") =>
  `<button class="ide-icon-button" data-action="${action}" aria-label="${e(label)}" title="${e(label)}" ${attributes}>${glyph(name)}</button>`;

export function shell() {
  const tab = ([id, label]) =>
    `<button class="sidebar-tab ${id === "explorer" ? "active" : ""}" role="tab" data-action="sidebar" data-view="${id}">${e(label)}</button>`;
  return `<div class="ide-shell">
    <header class="ide-titlebar"><button class="ide-brand" data-action="home" title="На главный экран" aria-label="Blueprints IDE — главный экран"><img src="/ide/mark.svg" alt=""/><span>Blueprints <b>IDE</b></span></button><button class="ide-tools-trigger" id="ide-tools-trigger" data-action="tools-menu" aria-haspopup="true" aria-expanded="false" title="Все инструменты (Alt+T)">${glyph("grid", 15)}<span>Инструменты</span>${glyph("down", 11)}</button><nav id="ide-workspaces" class="ide-workspaces" aria-label="Режим работы"></nav><button class="ide-command-trigger" data-action="palette" title="Файлы и команды (Ctrl K)">${glyph("search", 14)}<span>Поиск</span><kbd>Ctrl K</kbd></button><div class="ide-title-actions" id="ide-title-actions"></div></header>
    <div class="ide-body">
    <aside class="ide-sidebar"><div class="ide-sidebar-head"><div class="sidebar-tabs" role="tablist" aria-label="Боковая панель">${[["explorer", "Файлы"], ["search", "Поиск"], ["outline", "Структура"]].map(tab).join("")}</div><div id="ide-sidebar-actions"></div></div><div id="ide-sidebar-body" class="ide-sidebar-body"></div></aside><div class="ide-sidebar-resizer" role="separator" aria-orientation="vertical" aria-label="Ширина дерева файлов" tabindex="0"></div>
    <main class="ide-main"><div id="ide-tabs" class="ide-tabs" role="tablist" aria-label="Открытые файлы"></div><div id="ide-toolbar" class="ide-toolbar"></div><div id="ide-content" class="ide-content"></div><div class="ide-panel-resizer" role="separator" aria-orientation="horizontal" aria-label="Высота панели вывода" tabindex="0"></div><section id="ide-panel" class="ide-panel" aria-label="Результаты работы"><div class="ide-panel-head"><div role="tablist" aria-label="Панели результатов"><button data-action="panel" data-panel="output" role="tab" class="active">Вывод</button><button data-action="panel" data-panel="problems" role="tab">Проблемы <span id="ide-problem-count">0</span></button><button data-action="panel" data-panel="run" role="tab">Параметры запуска</button></div><div class="ide-panel-tools">${iconButton("clear-output", "Очистить вывод", "close")}${iconButton("toggle-panel", "Скрыть панель", "down")}</div></div><div id="ide-panel-body" class="ide-panel-body"></div></section></main></div>
    <div id="ide-tools-menu" class="ide-tools-menu" role="menu" aria-label="Инструменты" hidden></div>
    <footer class="ide-statusbar"><div><span id="ide-save-status">Готово</span><button data-action="workspace" data-workspace="verify" id="ide-quality-status" hidden></button></div><div><button data-action="goto-line" id="ide-cursor-status" hidden>Стр 1, стлб 1</button></div></footer>
  </div>`;
}

export function titleActions(project, busy) {
  return `${project ? button(busy ? "stop" : "run", busy ? "Стоп" : "Запустить", busy ? "close" : "play", `ide-button small ${busy ? "danger" : "run"}`) : ""}${iconButton("settings", "Настройки", "settings")}`;
}

export function welcome({ recent = [], project = null, summary = "" }) {
  return `<section class="ide-welcome"><div class="welcome-content">${project ? `<div class="welcome-resume"><div><small>Продолжить</small><b>${e(project.name)}</b><span>${e(summary || project.root)}</span></div><div>${button("workspace", "Обзор", "nodes", "ide-button small primary", 'data-workspace="overview"')}${button("workspace", "Задачи", "target", "ide-button small", 'data-workspace="tasks"')}${button("workspace", "Проверка", "shield", "ide-button small", 'data-workspace="verify"')}</div></div>` : ""}<div class="welcome-eyebrow"><img src="/ide/mark.svg" alt=""/>JAVA ↔ БЛУПРИНТ · АНАЛИЗ · ПРОВЕРКА ПОВЕДЕНИЯ</div><h1>Разберитесь в чужом Java-коде.<br><span>Меняйте без страха сломать.</span></h1><p class="welcome-lead">Откройте проект и сразу увидите карту: точку входа, дерево вызовов, путь данных от ввода к выводу и самые рискованные методы. IDE сама исправит то, что умеет, и после каждого изменения запустит старую и новую версию на ваших тестах. Если поведение разошлось, изменение откатывается одной кнопкой.</p><div class="welcome-actions">${button("open-folder", "Открыть папку", "folder", "ide-button primary large")}${button("open-example", "Открыть пример монолита", "rocket", "ide-button large", 'data-example="shop-monolith"')}${button("new-project", "Новый проект", "plus", "ide-button large subtle")}</div><div class="welcome-flow"><div><span>Обзор</span><b>Понять программу</b><small>Карта, дерево вызовов, с чего начать</small></div><i>→</i><div><span>Метод</span><b>Прочитать логику</b><small>Схема шагов рядом с кодом, правка блоками</small></div><i>→</i><div><span>Задачи</span><b>Исправить</b><small>Риски по приоритету, автоисправления</small></div><i>→</i><div><span>Проверка</span><b>Ничего не сломать</b><small>Эталон против новой версии на тестах</small></div></div><div class="welcome-bottom"><span>${glyph("folder", 15)}Файлы сохраняются в вашу папку</span><span>${glyph("bolt", 15)}Java 21 на сервере</span><span>${glyph("code", 15)}Исходники остаются обычной Java</span></div></div><aside class="welcome-right"><div class="welcome-graph"><div class="welcome-node entry">${glyph("method", 16)}countPairs(values)</div><span class="welcome-wire"></span><div class="welcome-node condition">${glyph("loop", 16)}for a · for b · O(n²)</div><div class="welcome-branches"><div><small>было</small><span class="welcome-wire"></span><div class="welcome-node">Сравнить каждую пару</div></div><div><small>стало</small><span class="welcome-wire"></span><div class="welcome-node result">Индекс частот · O(n)</div></div></div><span class="welcome-graph-caption">Диагноз → патч → проверка поведения ✓</span></div><div class="welcome-recent"><h2>Примеры</h2>${EXAMPLES.map((item) => `<button data-action="open-example" data-example="${item.id}">${glyph(item.icon, 17)}<span><b>${e(item.title)}</b><small>${e(item.detail)}</small></span>${glyph("chevron", 14)}</button>`).join("")}<h2>Недавние проекты</h2>${
    recent.length
      ? recent
          .slice(0, 4)
          .map(
            (item) =>
              `<button data-action="recent" data-root="${e(item.root)}">${glyph("folder", 17)}<span><b>${e(item.name)}</b><small>${e(item.root)}</small></span>${glyph("chevron", 14)}</button>`,
          )
          .join("")
      : `<p>Здесь появятся папки, которые вы откроете.</p>`
  }</div></aside></section>`;
}

export const EXAMPLES = [
  {
    id: "shop-monolith",
    title: "Интернет-магазин · монолит",
    detail: "~1000 строк: классы, коллекции, исключения, команды из stdin",
    icon: "layers",
  },
  {
    id: "large-monolith",
    title: "Статистика · 1000 строк",
    detail: "51 метод, O(n²) подсчёт пар, декомпозиция вычислений",
    icon: "chart",
  },
  {
    id: "language-showcase",
    title: "Обязательный Java scope",
    detail: "Интерфейсы, исключения, коллекции, record, enum, лямбды",
    icon: "code",
  },
];

export function tabs(store) {
  if (!store.tabs.length)
    return `<span class="ide-tab-placeholder">Рабочая область</span>`;
  return store.tabs
    .map((path) => {
      const document = store.documents.get(path);
      return `<div class="ide-file-tab ${path === store.activePath ? "active" : ""}" draggable="true" data-tab="${e(path)}"><button role="tab" aria-selected="${path === store.activePath}" data-action="activate-tab" data-path="${e(path)}" title="${e(path)}"><span class="file-type ${document.language}">${document.language === "java" ? "J" : glyph("file", 13)}</span><span>${e(document.name)}</span>${document.dirty ? '<i class="tab-dirty" title="Не сохранён"></i>' : ""}${document.external ? '<i class="tab-external" title="Изменён снаружи">!</i>' : ""}</button><button class="tab-close" data-action="close-tab" data-path="${e(path)}" aria-label="Закрыть ${e(document.name)}">×</button></div>`;
    })
    .join("");
}

export function toolbar(document, mode, project, busy) {
  if (!project)
    return `<span class="toolbar-hint">Добро пожаловать в Blueprints IDE</span><span class="toolbar-spacer"></span>`;
  const path = document?.path;
  const breadcrumbs = path
    ? path
        .split("/")
        .map(
          (part, index, array) =>
            `${index ? "<i>›</i>" : ""}<span class="${index === array.length - 1 ? "current" : ""}">${e(part)}</span>`,
        )
        .join("")
    : e(project.name);
  return `<div class="ide-breadcrumb">${glyph("folder", 14)}${breadcrumbs}</div><span class="toolbar-spacer"></span>${
    document?.language === "java"
      ? `<div class="ide-mode-switch" role="group" aria-label="Представление файла">${[
          ["blueprint", "Блупринт", "graph"],
          ["split", "Вместе", "split"],
          ["code", "Код", "code"],
        ]
          .map(
            ([id, label, name]) =>
              `<button data-action="editor-mode" data-mode="${id}" class="${mode === id ? "active" : ""}" aria-pressed="${mode === id}">${glyph(name, 14)}${label}</button>`,
          )
          .join("")}</div>`
      : ""
  }${document?.dirty && !document.readOnly ? button("save", "Сохранить", "download", "ide-button small primary") : ""}${button("verify", "Проверить", "shield", "ide-button small", 'title="Сравнить поведение с эталоном (F6)"')}`;
}

export function projectTree(
  project,
  tree,
  expanded,
  activePath,
  selectedPath,
  loading = false,
) {
  if (!project)
    return `<div class="sidebar-empty">${glyph("folder", 30)}<h3>Откройте проект</h3><p>Выберите папку с Java-файлами на компьютере.</p>${button("open-folder", "Открыть папку", "folder", "ide-button primary small")}</div>`;
  function children(directory, depth) {
    const entries = tree.get(directory) ?? [];
    return entries
      .map((item) => {
        const folder = item.kind === "directory";
        const open = expanded.has(item.path);
        const selected = item.path === selectedPath;
        const active = item.path === activePath;
        const action = folder
          ? "toggle-folder"
          : item.kind === "link"
            ? "link-info"
            : "open-file";
        return `<div role="treeitem" aria-level="${depth + 1}" ${folder ? `aria-expanded="${open}"` : ""} aria-selected="${active}" class="tree-item ${active ? "active" : ""} ${selected ? "selected" : ""}" data-tree-path="${e(item.path)}"><button data-action="${action}" data-path="${e(item.path)}" style="padding-left:${12 + depth * 15}px" title="${e(item.path)}"><span class="tree-chevron ${open ? "open" : ""}">${folder ? glyph("chevron", 11) : ""}</span><span class="tree-file-icon ${item.language}">${folder ? glyph("folder", 15) : item.kind === "link" ? "↗" : item.language === "java" ? "J" : glyph("file", 14)}</span><span>${e(item.name)}</span></button></div>${folder && open ? `<div role="group">${tree.has(item.path) ? children(item.path, depth + 1) : '<div class="tree-loading">Загрузка…</div>'}</div>` : ""}`;
      })
      .join("");
  }
  return `<div class="tree-project"><button data-action="overview" title="Обзор проекта">${glyph("down", 11)}<b>${e(project.name)}</b><span>JAVA</span></button></div><div class="project-tree" role="tree" aria-label="Файлы ${e(project.name)}">${children("", 0) || `<p class="tree-loading">${loading ? "Загрузка…" : "В папке пока нет файлов"}</p>`}</div><div class="explorer-bottom"><span>${project.capabilities?.disk ? "Сохраняется в папку на диске" : "Хранится в памяти страницы"}</span><button data-action="export-project">${glyph("download", 12)}ZIP</button></div>`;
}

export function searchSidebar(state) {
  return `<form id="project-search-form" class="project-search-form"><label class="sr-only" for="project-search">Поиск по проекту</label><div class="search-input-wrap"><input id="project-search" name="query" placeholder="Найти в проекте…" value="${e(state.query)}" autocomplete="off"/><button type="submit" title="Искать" aria-label="Искать">${glyph("search", 14)}</button></div><div class="search-options"><label><input type="checkbox" name="caseSensitive" ${state.caseSensitive ? "checked" : ""}/>Регистр</label><label><input type="checkbox" name="wholeWord" ${state.wholeWord ? "checked" : ""}/>Слово целиком</label></div><input name="include" aria-label="Часть пути для поиска" placeholder="Фильтр пути, например src/" value="${e(state.include)}"/><details ${state.replacement ? "open" : ""}><summary>Найти и заменить</summary><input name="replacement" aria-label="Заменить на" placeholder="Заменить на…" value="${e(state.replacement)}"/><button type="button" class="ide-button small" data-action="preview-replace">Просмотреть замену</button></details></form><div class="search-summary">${state.busy ? "Ищем в файлах…" : state.result ? `${state.result.results.length} совпадений · ${state.result.searchedFiles} файлов${state.result.limited ? " · результат ограничен" : ""}` : "Поиск по текстовым файлам проекта"}</div><div class="project-search-results">${state.result?.results?.length ? state.result.results.map((match) => `<button data-action="search-result" data-path="${e(match.path)}" data-line="${match.line}" data-column="${match.column}" data-length="${match.end - match.start}"><span>${glyph("file", 12)}${e(basename(match.path))}<small>${match.line}</small></span><code>${e(match.preview.trim())}</code></button>`).join("") : state.result ? `<div class="sidebar-empty compact"><h3>Совпадений нет</h3><p>Измените запрос или уберите фильтр пути.</p></div>` : ""}</div>`;
}

export function outlineSidebar(document) {
  if (!document || document.language !== "java")
    return `<div class="sidebar-empty"><h3>Структура Java</h3><p>Откройте Java-файл, чтобы перейти к его методам.</p></div>`;
  const model = document.currentModel;
  if (!model)
    return `<div class="sidebar-empty compact"><p>Структура обновляется после изменения кода.</p>${button("analyse", "Обновить", "loop", "ide-button small")}</div>`;
  return `<div class="outline-file"><span class="file-type java">J</span>${e(document.name)}</div>${model.package ? `<p class="outline-package">${e(model.package)}</p>` : ""}<div class="outline-methods">${model.methods.map((method) => `<button data-action="select-method" data-id="${e(method.id)}" class="${method.id === document.methodId ? "active" : ""}"><span>${glyph("method", 15)}</span><div><b>${e(method.name)}</b><small>${e(method.signature)}</small></div><em>${method.line}</em></button>`).join("") || '<p class="sidebar-note">У этого файла нет методов.</p>'}</div><p class="sidebar-note">Структуру разбирает javac. Выберите метод, чтобы открыть его блупринт.</p>`;
}

export function gitSidebar(result, loading) {
  if (loading) return `<p class="sidebar-note">Читаем Git-статус…</p>`;
  if (!result?.available)
    return `<div class="sidebar-empty">${glyph("diff", 28)}<h3>Изменения Git</h3><p>${e(result?.error ?? "Откройте проект с Git-репозиторием.")}</p>${button("refresh-git", "Обновить", "loop", "ide-button small")}</div>`;
  const names = {
    M: "Изменён",
    A: "Добавлен",
    D: "Удалён",
    R: "Переименован",
    "?": "Новый",
    U: "Конфликт",
  };
  return `<div class="git-branch">${glyph("branch", 15)}<b>${e(result.branch)}</b><small>${e(result.head ?? "")}</small></div><div class="git-counts"><span>${result.entries.length} файлов</span><span>${result.counts.conflicts} конфликтов</span></div><div class="git-files">${result.entries.map((item) => `<button data-action="git-file" data-path="${e(item.path)}" data-staged="${item.working === " "}"><span class="git-code ${item.conflict ? "conflict" : ""}">${e(item.code.trim() || "M")}</span><span><b>${e(basename(item.path))}</b><small>${e(dirname(item.path))}</small></span><em>${e(names[item.working] ?? names[item.index] ?? "Изменён")}</em></button>`).join("") || '<p class="sidebar-note">Рабочая папка чистая.</p>'}</div><p class="sidebar-note">Панель показывает состояние и diff. Коммиты и отправку изменений выполняйте в своём Git-клиенте.</p>`;
}

export function historySidebar(document, entries, loading) {
  if (!document)
    return `<div class="sidebar-empty"><h3>История файла</h3><p>Выберите файл в проекте.</p></div>`;
  return `<div class="history-file">${glyph("history", 16)}<b>${e(document.name)}</b></div><p class="sidebar-note">До 20 предыдущих версий перед сохранением. Хранятся локально в данных IDE.</p>${loading ? '<p class="sidebar-note">Загрузка…</p>' : entries.length ? `<div class="history-entries">${entries.map((entry, index) => `<button data-action="history-version" data-version="${e(entry.id)}"><i></i><span><b>${e(timeLabel(entry.time))}</b><small>${entry.reason === "before-trash" ? "Перед удалением" : "Перед сохранением"} · ${byteSize(entry.bytes)}</small></span>${glyph("chevron", 13)}</button>`).join("")}</div>` : '<div class="sidebar-empty compact"><h3>Пока нет версий</h3><p>После первого сохранения здесь появится предыдущая версия.</p></div>'}`;
}

export function graphHeader(document) {
  const model = document.currentModel;
  const methods = model?.methods ?? [];
  return `<div class="ide-graph-header"><div><span class="graph-header-icon">${glyph("graph", 17)}</span><b>Блупринт</b><span class="graph-live-label ${!model ? "stale" : ""}">${model ? "Из Java-кода" : "Нужно обновить"}</span></div><label class="sr-only" for="ide-method-select">Метод</label><select id="ide-method-select" ${!methods.length ? "disabled" : ""}>${methods.map((method) => `<option value="${e(method.id)}" ${method.id === document.methodId ? "selected" : ""}>${e(method.owner + " · " + method.name)}</option>`).join("") || "<option>Нет методов</option>"}</select><span id="ide-method-metrics" class="q-metrics"></span>${button("new-method", "Новый метод", "plus", "ide-button small subtle", model?.valid ? "" : "disabled")}${iconButton("analyse", "Обновить схему", "loop")}</div><div id="ide-method-why"></div>`;
}

export function graphEmpty(document, analysing) {
  const model = document.currentModel;
  if (analysing)
    return `<div class="graph-empty"><span class="ide-spinner"></span><h3>Читаем Java-код</h3><p>Собираем методы и связи между блоками.</p></div>`;
  if (document.analysisError)
    return `<div class="graph-empty error">${glyph("warning", 35)}<h3>Не удалось построить блупринт</h3><p>${e(document.analysisError)}</p>${button("analyse", "Попробовать ещё раз", "loop", "ide-button small")}</div>`;
  if (model && !model.valid)
    return `<div class="graph-empty error">${glyph("warning", 35)}<h3>Сначала исправьте синтаксис</h3><p>Ошибка в Java мешает построить точную схему. Подробности — в панели «Проблемы».</p>${button("show-problems", "Показать ошибки", "warning", "ide-button small")}</div>`;
  if (model && !model.methods.length)
    return `<div class="graph-empty">${glyph("layers", 35)}<h3>Здесь пока нет методов</h3><p>Выберите класс с методами или добавьте метод в редакторе кода.</p>${button("show-code", "Открыть код", "code", "ide-button small")}</div>`;
  return `<div class="graph-empty">${glyph("graph", 35)}<h3>Код изменился</h3><p>Обновите блупринт, чтобы увидеть текущую логику.</p>${button("analyse", "Построить блупринт", "loop", "ide-button primary small")}</div>`;
}

export function nodeInspector(node, document, findingsHtml = "") {
  if (!node)
    return `<div class="node-inspector-hint">${glyph("info", 14)}Нажмите блок для объяснения · двойной щелчок — изменить · перетаскивайте фон · Ctrl + колесо — масштаб</div>`;
  const editable =
    node.editStart >= 0 && !document.readOnly && document.currentModel;
  const insertable =
    editable &&
    ["operation", "return", "throw", "break", "continue"].includes(node.kind);
  const deletable =
    editable && ["operation", "variable", "return", "throw"].includes(node.kind);
  return `<div class="node-inspector-detail"><div><span class="node-kind-badge ${e(node.kind)}">${glyph(nodeIcon(node.kind), 15)}${e(nodeLabel(node.kind))}</span><button data-action="close-node" aria-label="Закрыть описание">×</button></div><p>${e(describeNode(node))}</p>${node.code ? `<code>${e(node.code.length > 450 ? node.code.slice(0, 450) + "…" : node.code)}</code>` : ""}${findingsHtml}<footer><span>${node.line > 0 ? "Строка " + node.line : "Структурный блок"}</span>${node.start >= 0 ? button("node-source", "К строке", "code", "ide-button small") : ""}${insertable ? button("node-insert-before", "Блок до", "plus", "ide-button small") + button("node-insert-after", "Блок после", "plus", "ide-button small") : ""}${deletable ? button("node-delete", "Удалить", "close", "ide-button small") : ""}${editable ? button("edit-node", "Изменить блок", "edit", "ide-button small primary") : ""}</footer></div>`;
}

export function problemsPanel(problems) {
  if (!problems.length)
    return `<div class="panel-empty">${glyph("circleCheck", 22)}<span>Ошибок синтаксиса не найдено</span><small>Полную проверку типов выполнит «Проверить сборку».</small></div>`;
  return `<div class="problem-list">${problems.map((problem) => `<button data-action="problem" data-path="${e(problem.path)}" data-line="${problem.line ?? 1}" data-column="${problem.column ?? 1}"><span class="problem-severity ${String(problem.severity).toLocaleLowerCase()}">${glyph(problem.severity === "ERROR" || problem.severity === "error" ? "warning" : "info", 14)}</span><span>${e(problem.message)}</span><small>${e(basename(problem.path))}:${problem.line ?? 1}</small><em>${e(problem.source ?? "javac parse")}</em></button>`).join("")}</div>`;
}

export function outputPanel(task) {
  if (!task)
    return `<div class="panel-empty">${glyph("terminal", 23)}<span>Программа ещё не запускалась</span><small>Нажмите «Запустить» или F5. Результат появится здесь.</small></div>`;
  const busy = ["queued", "running"].includes(task.status);
  const labels = {
    queued: "В очереди",
    running: "Выполняется",
    done: "Успешно",
    failed: "Ошибка",
    cancelled: "Остановлено",
  };
  return `${task.stale ? '<div class="task-stale-notice">Код изменён после запуска. Этот результат относится к предыдущей версии; запустите программу снова.</div>' : ""}<div class="task-summary ${e(task.status)}"><span>${busy ? '<i class="ide-spinner small"></i>' : glyph(task.status === "done" ? "circleCheck" : "warning", 14)}${labels[task.status] ?? task.status}</span><b>${e(task.stage ?? "")}</b><small>${task.exitCode !== null && task.exitCode !== undefined ? "Код " + task.exitCode : ""}${task.finishedAt ? " · " + timeLabel(task.finishedAt) : ""}</small></div><div class="task-streams"><pre class="task-stdout">${e(task.stdout || (!busy && task.status === "done" ? "Программа завершилась без вывода." : ""))}</pre>${task.stderr ? `<pre class="task-stderr">${e(task.stderr)}</pre>` : ""}${task.timedOut ? '<p class="task-limit">Превышено время выполнения. Задача остановлена.</p>' : ""}${task.truncated ? '<p class="task-limit">Превышен лимит вывода 256 КиБ. Задача остановлена.</p>' : ""}${task.hint ? `<p class="task-hint">${e(task.hint)}</p>` : ""}</div>`;
}

export function runSettingsPanel(config, overview) {
  return `<form id="run-settings-form" class="run-settings-form"><label>Главный класс<input name="mainClass" placeholder="Автоматически, если main один" value="${e(config.mainClass)}" list="ide-main-classes" autocomplete="off"/><datalist id="ide-main-classes">${(overview?.entryPoints ?? []).map((item) => `<option value="${e(item.className)}">${e(item.path)}</option>`).join("")}</datalist></label><label class="run-input-label">Стандартный ввод (stdin)<textarea name="input" rows="3" placeholder="Данные для Scanner или BufferedReader" maxlength="32768">${e(config.input)}</textarea></label><div><button type="submit" class="ide-button primary small">${glyph("play", 14)}Сохранить параметры</button><p>Java 21 · javac без annotation processors · запуск до 10 с, heap 128 МиБ</p></div></form>`;
}

export function modalFrame(title, content, footer = "", className = "") {
  return `<div class="ide-modal ${className}"><header><h2>${e(title)}</h2><button data-action="close-modal" aria-label="Закрыть диалог">×</button></header><div class="ide-modal-content">${content}</div>${footer ? `<footer>${footer}</footer>` : ""}</div>`;
}

export function languageModal() {
  return modalFrame(
    "Язык блупринтов",
    `<p class="modal-lead">Сейчас IDE работает с Java. Остальные языки запланированы: их блупринты пока недоступны.</p><div class="language-grid">${LANGUAGES.map((language) => `<button class="language-card ${language.available ? "available" : "coming"}" data-action="${language.available ? "choose-java" : "coming-soon"}" data-language="${e(language.name)}" aria-disabled="${!language.available}"><span style="--language-color:${language.color}">${e(language.extension)}</span><div><h3>${e(language.name)}</h3><p>${e(language.description)}</p></div><small>${language.available ? "Доступно" : "Coming soon"}</small></button>`).join("")}</div>`,
    button("close-modal", "Готово", null, "ide-button primary"),
  );
}

export function shortcutsModal() {
  return modalFrame(
    "Горячие клавиши",
    `<div class="shortcut-grid">${SHORTCUTS.map(([keys, label]) => `<div><span>${e(label)}</span><kbd>${e(keys)}</kbd></div>`).join("")}</div>`,
    button("close-modal", "Готово", null, "ide-button primary"),
  );
}

export function settingsModal(settings) {
  const checkbox = (name, label, detail) =>
    `<label class="setting-checkbox"><input type="checkbox" name="${name}" ${settings[name] ? "checked" : ""}/><span><b>${e(label)}</b><small>${e(detail)}</small></span></label>`;
  return modalFrame(
    "Настройки IDE",
    `<form id="ide-settings-form"><div class="settings-fields"><label>Оформление<select name="theme">${[
      ["light", "Светлое"],
      ["dark", "Тёмное"],
      ["system", "Как в системе"],
    ]
      .map(
        ([value, label]) =>
          `<option value="${value}" ${settings.theme === value ? "selected" : ""}>${label}</option>`,
      )
      .join(
        "",
      )}</select></label><label>Размер кода<select name="fontSize">${[11, 12, 13, 14, 15, 16, 18, 20, 22, 24].map((value) => `<option value="${value}" ${settings.fontSize === value ? "selected" : ""}>${value} px</option>`).join("")}</select></label><label>Отступ<select name="tabSize">${[2, 4, 8].map((value) => `<option value="${value}" ${settings.tabSize === value ? "selected" : ""}>${value} пробела</option>`).join("")}</select></label><label>Открывать Java как<select name="editorView">${[
      ["blueprint", "Блупринт"],
      ["split", "Код и блупринт"],
      ["code", "Код"],
    ]
      .map(
        ([value, label]) =>
          `<option value="${value}" ${settings.editorView === value ? "selected" : ""}>${label}</option>`,
      )
      .join(
        "",
      )}</select></label><label>Направление графа<select name="graphDirection"><option value="TB" ${settings.graphDirection === "TB" ? "selected" : ""}>Сверху вниз</option><option value="LR" ${settings.graphDirection === "LR" ? "selected" : ""}>Слева направо</option></select></label></div><div class="settings-checkboxes">${checkbox("autoAnalyse", "Обновлять блупринт автоматически", "После паузы при редактировании Java")}${checkbox("wordWrap", "Переносить длинные строки", "Для удобства чтения исходного кода")}${checkbox("restoreSession", "Запоминать открытые вкладки", "Отдельно для каждой папки проекта")}${checkbox("reduceMotion", "Уменьшить анимацию", "Более спокойные переходы в интерфейсе")}${checkbox("showWhitespace", "Выделять область отступов", "Вертикальные направляющие в редакторе")}</div><p class="settings-local-note">Настройки хранятся только на этом компьютере.</p></form>`,
    `<button class="ide-button primary" type="submit" form="ide-settings-form">Сохранить настройки</button>`,
  );
}

export function diffView(before, after, labels = {}) {
  const operations = diffLines(before, after);
  return `<div class="ide-diff"><div class="diff-labels"><span>${e(labels.before ?? "Предыдущая версия")}</span><span>${e(labels.after ?? "Текущая версия")}</span></div><div class="diff-lines">${operations.map((line) => `<div class="diff-line ${line.type}"><span>${line.oldLine ?? ""}</span><span>${line.newLine ?? ""}</span><i>${line.type === "insert" ? "+" : line.type === "delete" ? "−" : " "}</i><code>${e(line.text) || " "}</code></div>`).join("")}</div></div>`;
}

export function overviewModal(project, overview) {
  return modalFrame(
    project.name,
    `<div class="overview-project-path">${glyph("folder", 17)}${e(project.root)}</div><div class="overview-stats">${[
      [overview.javaFiles, "Java-файлов"],
      [overview.packages.length, "Пакетов"],
      [overview.lines, "Строк Java"],
      [overview.entryPoints.length, "Точек входа"],
    ]
      .map(
        ([value, label]) => `<div><b>${value}</b><span>${label}</span></div>`,
      )
      .join(
        "",
      )}</div><div class="overview-columns"><section><h3>Можно запустить</h3>${overview.entryPoints.length ? overview.entryPoints.map((item) => `<button class="overview-entry" data-action="open-entry" data-path="${e(item.path)}" data-class="${e(item.className)}">${glyph("play", 15)}<span><b>${e(item.className)}</b><small>${e(item.path)}</small></span></button>`).join("") : "<p>Точки входа не найдены. В параметрах запуска можно указать главный класс вручную.</p>"}<h3>Пакеты</h3><div class="package-list">${overview.packages
      .slice(0, 30)
      .map(
        (item) =>
          `<span>${e(item.name)}<small>${item.files} файлов</small></span>`,
      )
      .join(
        "",
      )}</div></section><section><h3>О проекте</h3><p>Система сборки: <b>${e(project.buildSystem)}</b></p><p>Блупринты строятся для методов выбранного файла через настоящий Java-парсер. Навигационный обзор проекта использует быстрый лексический индекс.</p>${project.buildSystem !== "plain" ? '<div class="overview-notice">Maven/Gradle-проект можно открыть и изучать. Встроенная сборка использует стандартную Java 21; загрузка зависимостей и запуск build-скриптов пока не реализованы.</div>' : ""}${overview.limited ? '<div class="overview-notice">Обзор ограничен первыми 300 Java-файлами и 8 МиБ исходников. Остальные файлы доступны через дерево проекта.</div>' : ""}<h3>Файлы проекта</h3>${overview.configs.map((item) => `<button class="overview-config" data-action="open-config" data-path="${e(item.path)}">${glyph("file", 13)}${e(item.path)}</button>`).join("")}</section></div>`,
    button("close-modal", "К проекту", null, "ide-button primary"),
    "wide",
  );
}

export function newMethodModal(classes, selected) {
  return modalFrame(
    "Новый метод из блоков",
    `<form id="new-method-form"><p class="modal-lead">IDE добавит пустой метод в класс и откроет его блупринт. Дальше стройте логику узлами: правый клик по полю — палитра, провода тянутся от пинов.</p><label class="modal-field">Класс<select name="owner">${classes.filter((item) => item.kind === "CLASS").map((item) => `<option ${item.name === selected ? "selected" : ""}>${e(item.name)}</option>`).join("")}</select></label><label class="modal-field">Имя метода<input name="name" value="calculate" required autocomplete="off" pattern="[A-Za-z_$][A-Za-z0-9_$]*"/></label><label class="modal-field">Тип результата<input name="returnType" value="int" list="new-method-types" autocomplete="off"/><datalist id="new-method-types">${["void", "int", "long", "double", "boolean", "String"].map((type) => `<option value="${type}">`).join("")}</datalist></label><label class="modal-field">Параметры<input name="params" value="int a, int b" autocomplete="off" placeholder="int a, String name"/></label><label class="setting-checkbox"><input type="checkbox" name="static" checked/><span><b>static</b><small>Метод класса, вызывается без объекта</small></span></label></form>`,
    '<button type="submit" form="new-method-form" class="ide-button primary">Создать и открыть блупринт</button>',
  );
}

export function newFileModal(folder = "") {
  return modalFrame(
    "Новый файл",
    `<form id="new-file-form"><label class="modal-field">Путь внутри проекта<input name="path" value="${e(folder ? folder + "/" : "")}NewClass.java" required autocomplete="off" maxlength="1024"/></label><label class="modal-field">Шаблон<select name="template">${JAVA_FILE_TEMPLATES.map((item) => `<option value="${item.id}">${e(item.label)} — ${e(item.description)}</option>`).join("")}</select></label><p class="modal-note">Для файла в пакете Java укажите package в исходном коде. Имя public-класса должно совпадать с именем файла.</p></form>`,
    '<button type="submit" form="new-file-form" class="ide-button primary">Создать файл</button>',
  );
}

export function nodeEditModal(node, document, action = "replace") {
  const insert = action !== "replace";
  return modalFrame(
    insert
      ? action === "before"
        ? "Новый блок перед выбранным"
        : "Новый блок после выбранного"
      : "Изменить блок",
    `<p class="modal-lead">${e(nodeLabel(node.kind))} · строка ${node.line}. ${insert ? "Введите Java-инструкцию: она станет новым блоком на схеме." : "Изменение сначала проверит Java-парсер, затем оно появится в редакторе."} Сохраните файл, чтобы записать его на диск.</p><form id="edit-node-form"><label class="modal-field">${insert ? "Java-инструкция" : "Java для этого блока"}<textarea name="code" class="modal-code" rows="9" required spellcheck="false">${e(insert ? 'System.out.println("Шаг");' : node.editCode)}</textarea></label><div id="node-edit-error" class="modal-inline-error" role="alert" hidden></div></form>`,
    `<button type="submit" form="edit-node-form" class="ide-button primary">${insert ? "Добавить блок" : "Применить к блупринту"}</button>`,
    "wide",
  );
}

export function aboutModal(boot) {
  return modalFrame(
    "Blueprints IDE 4",
    `<div class="about-brand"><img src="/ide/mark.svg" alt=""/><div><h3>Java, которую видно и можно проверить</h3><p>Веб-IDE: карта проекта, схемы методов и блоки, диагностика и Big O, исправления и проверка сохранения поведения.</p></div></div><dl class="about-facts"><dt>Версия</dt><dd>${e(boot.version)}</dd><dt>Java</dt><dd>${e(boot.runtime?.java ?? "21")}</dd><dt>Данные</dt><dd>Файлы остаются в вашей папке (браузер сохраняет их через File System Access API), разбор и запуск выполняет Java-сервер</dd></dl><p class="modal-note">Java → AST javac → граф методов → правки → Java → javac + JVM → сравнение с эталоном. Полноценный отладчик JVM, загрузка зависимостей Maven/Gradle и другие языки в эту версию не входят.</p>`,
    button("close-modal", "Готово", null, "ide-button primary"),
  );
}
