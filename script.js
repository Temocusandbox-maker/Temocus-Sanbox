const runButton = document.getElementById("runButton");
const codeEditor = document.getElementById("code");
const output = document.getElementById("output");
const secret = document.getElementById("secret");

function runTemocus(source) {
  const variables = Object.create(null);
  const messages = [];
  const debug = [];
  const errors = [];
  const inputs = [];
  const ifValues = Object.create(null);

  let fininResult = false;
  let steps = 0;
  let halted = false;
  let cycleActive = false;

  const MAX_STEPS = 10000;
  const lines = source.split(/\r?\n/);

  function fail(message) {
    throw new Error(message);
  }

  function isConditionHeader(line) {
    return /^\*if\d*\s+/.test(line) || line.startsWith("*not if");
  }

  function getValue(text) {
    text = text.trim();

    function splitConcatenation(expression) {
      const parts = [];
      let current = "";
      let quote = null;

      for (const char of expression) {
        if ((char === '"' || char === "'") && !quote) {
          quote = char;
          current += char;
        } else if (char === quote) {
          quote = null;
          current += char;
        } else if (char === "|" && !quote) {
          parts.push(current.trim());
          current = "";
        } else {
          current += char;
        }
      }

      parts.push(current.trim());
      return parts;
    }

    const parts = splitConcatenation(text);

    if (parts.length > 1) {
      return parts.map(part => String(getValue(part))).join("");
    }

    if (
      (text.startsWith('"') && text.endsWith('"')) ||
      (text.startsWith("'") && text.endsWith("'"))
    ) {
      return text.slice(1, -1);
    }

    if (/^-?\d+(?:[.,]\d+)?$/.test(text)) {
      return Number(text.replace(",", "."));
    }

    if (text === "true") return true;
    if (text === "false") return false;

    if (text === "{finin}.upper") return fininResult;

    if (text === "{human.otv}" || text === "{human.otv1}" || text === "{human.otv1}.first1" || text === "{human.otv}.first1") return inputs[0] ?? "";
    if (text === "{human.otv}.second2" || text === "{human.otv1}.second2") return inputs[1] ?? "";
    if (text === "{human.otv}.third3" || text === "{human.otv1}.third3") return inputs[2] ?? "";

    if (
      text === ".upper" ||
      text === "{human.otv}.upper" ||
      text === "{human.otv1}.upper"
    ) {
      return inputs[inputs.length - 1] ?? "";
    }

    const name = text.startsWith("+") ? text.slice(1) : text;

    if (Object.prototype.hasOwnProperty.call(variables, name)) {
      return variables[name];
    }

    fail(`Неизвестное значение: ${text}`);
  }

  function setVariable(name, value) {
    variables[name] = value;
    debug.push(`Переменная ${name} = ${value}`);
  }

  function evaluateMath(expression) {
    const match = expression.match(
      /^\s*(\+?[A-Za-z_]\w*|-?\d+(?:[.,]\d+)?)\s*(@\+\+@|@--@|@x\*@|@%\/@|@%%@)\s*(\+?[A-Za-z_]\w*|-?\d+(?:[.,]\d+)?)\s*$/
    );

    if (!match) {
      fail("Не удалось разобрать математическое выражение.");
    }

    const a = Number(getValue(match[1]));
    const operator = match[2];
    const b = Number(getValue(match[3]));

    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      fail("Для математической операции нужны числа.");
    }

    let result;

    switch (operator) {
      case "@++@":
        result = a + b;
        break;

      case "@--@":
        result = a - b;
        break;

      case "@x*@":
        result = a * b;
        break;

      case "@%/@":
        if (b === 0) fail("На ноль делить нельзя!");
        result = a / b;
        break;

      case "@%%@":
        result = (a / 100) * b;
        break;
    }

    return Number(result.toFixed(10));
  }

  // Разделение логических выражений
  function splitLogical(expression, operator) {
    const result = [];
    let current = "";
    let quote = null;
    let squareDepth = 0;
    let curlyDepth = 0;

    for (let i = 0; i < expression.length; i++) {
      const char = expression[i];

      if ((char === '"' || char === "'") && !quote) {
        quote = char;
        current += char;
        continue;
      }

      if (char === quote) {
        quote = null;
        current += char;
        continue;
      }

      if (!quote) {
        if (char === "[") squareDepth++;
        if (char === "]") squareDepth--;
        if (char === "{") curlyDepth++;
        if (char === "}") curlyDepth--;

        if (squareDepth === 0 && curlyDepth === 0) {
          const remaining = expression.slice(i);

          if (remaining.startsWith(operator)) {
            result.push(current.trim());
            current = "";
            i += operator.length - 1;
            continue;
          }
        }
      }

      current += char;
    }

    result.push(current.trim());
    return result;
  }

  // Проверка условий
  function evaluateCondition(condition, conditionName = "if") {
    condition = condition.trim();

    if (/^not\s+/i.test(condition)) {
      return !evaluateCondition(
        condition.replace(/^not\s+/i, ""),
        conditionName
      );
    }

    const andParts = splitLogical(condition, ",.");

    if (andParts.length > 1) {
      for (const part of andParts) {
        if (!evaluateCondition(part, conditionName)) {
          return false;
        }
      }

      return true;
    }

    const orParts = splitLogical(condition, "o.r");

    if (orParts.length > 1) {
      for (const part of orParts) {
        if (evaluateCondition(part, conditionName)) {
          return true;
        }
      }

      return false;
    }

    condition = condition.trim();

    const match = condition.match(
      /^(\[[^\]]+\]|\{human\.otv1?\}(?:\.(?:first1|second2|third3|upper))?|\.upper)\s*(>\.=|<\.=|≠@|@≠|@=|=@|>=|<=|>|<)\s*(.+?)\s*$/
    );

    if (!match) {
      fail(`Неизвестное условие: ${condition}`);
    }

    let leftText = match[1].trim();

    if (leftText.startsWith("[") && leftText.endsWith("]")) {
      leftText = leftText.slice(1, -1).trim();
    }

    const left = getValue(leftText);
    const operator = match[2];
    const rightText = match[3].trim();

    let right;
    let negate = false;

    const referenceMatch = rightText.match(
      /^(not\s+)?\{(if\d*)\}$/i
    );

    if (referenceMatch) {
      negate = Boolean(referenceMatch[1]);

      const referenceName = referenceMatch[2];

      if (
        !Object.prototype.hasOwnProperty.call(ifValues, referenceName) ||
        !Object.prototype.hasOwnProperty.call(
          ifValues[referenceName],
          leftText
        )
      ) {
        fail(
          `Нет предыдущего значения {${referenceName}} для ${leftText}.`
        );
      }

      right = ifValues[referenceName][leftText];
    } else {
      right = getValue(
        rightText.startsWith("[") && rightText.endsWith("]")
          ? rightText.slice(1, -1)
          : rightText
      );
    }

    if (!ifValues[conditionName]) {
      ifValues[conditionName] = Object.create(null);
    }

    ifValues[conditionName][leftText] = right;

    let result;

    switch (operator) {
      case "@=":
      case "=@":
        result = left == right;
        break;

      case "≠@":
      case "@≠":
        result = left != right;
        break;

      case ">":
        result = left > right;
        break;

      case "<":
        result = left < right;
        break;

      case ">=":
      case ">.=":
        result = left >= right;
        break;

      case "<=":
      case "<.=":
        result = left <= right;
        break;

      default:
        fail("Неизвестный оператор.");
    }

    return negate ? !result : result;
  }

  /*
   * Поиск конца ветви.
   * Вложенные условия пропускаются целиком.
   */
  function findConditionSeparator(start, limit) {
    for (let i = start; i < limit; i++) {
      const line = lines[i].trim();

      if (/^\*if\d*\s+/.test(line)) {
        const nested = parseConditionStructure(i, limit);
        i = nested.nextIndex - 1;
        continue;
      }

      if (line === ";(") {
        return i;
      }
    }

    return -1;
  }

  /*
   * Разбор конструкции:
   *
   * *if ...
   *   команды
   * ;(
   * *not if ;)
   *   команды
   * ;(
   */
  function parseConditionStructure(index, limit) {
    const header = lines[index].trim();

    if (!/^\*if\d*\s+/.test(header)) {
      fail("Ожидалось начало условия.");
    }

    const firstSeparator = findConditionSeparator(index + 1, limit);

    if (firstSeparator === -1) {
      fail("Не найден разделитель ;( у условия.");
    }

    const structure = {
      header,
      thenStart: index + 1,
      thenEnd: firstSeparator,
      elseHeader: null,
      elseStart: -1,
      elseEnd: -1,
      nextIndex: firstSeparator + 1
    };

    // Проверяем, есть ли следующая ветвь *not if
    let next = firstSeparator + 1;

    while (next < limit && !lines[next].trim()) {
      next++;
    }

    if (
      next < limit &&
      lines[next].trim().startsWith("*not if")
    ) {
      const elseSeparator = findConditionSeparator(next + 1, limit);

      if (elseSeparator === -1) {
        fail("Не найден разделитель ;( у *not if.");
      }

      structure.elseHeader = lines[next].trim();
      structure.elseStart = next + 1;
      structure.elseEnd = elseSeparator;
      structure.nextIndex = elseSeparator + 1;
    }

    return structure;
  }

  // Поиск закрытия старых циклов
  function findLoopClosing(start, limit) {
    let depth = 0;

    for (let i = start; i < limit; i++) {
      const line = lines[i].trim();

      if (/^&plrep(u)?\./.test(line)) {
        depth++;
      }

      if (line === ";(") {
        if (depth === 0) return i;
        depth--;
      }
    }

    return -1;
  }

  function runBlock(start, end) {
    if (halted) return null;

    for (let i = start; i < end; i++) {
      if (halted) break;

      steps++;

      if (steps > MAX_STEPS) {
        errors.push(
          "Превышен лимит команд. Возможно, цикл бесконечный."
        );

        halted = true;
        break;
      }

      const line = lines[i].trim();

      if (!line || line.startsWith("//") || line === ";(" || line === ":(") {
        continue;
      }

      try {
        // Ввод данных
        const inputMatch = line.match(
          /^\$human\.otv\s*\(\s*["']([\s\S]*?)["']\s*\)\s*:?$/
        );

        if (inputMatch) {
          const answer = window.prompt(inputMatch[1]);
          const value = answer ?? "";

          inputs.push(value);
          setVariable("humanAnswer" + inputs.length, value);
          continue;
        }

        // Случайные числа
        const random = line.match(
          /^\+([A-Za-z_]\w*)\s*=\s*rand<\s*(-?\d+)\s*,\s*(-?\d+)\s*>\s*:?$/
        );

        if (random) {
          const min = Number(random[2]);
          const max = Number(random[3]);

          if (min > max) {
            fail("Первое число rand должно быть меньше или равно второму.");
          }

          const value = Math.floor(
            Math.random() * (max - min + 1)
          ) + min;

          setVariable(random[1], value);
          continue;
        }

        // Создание переменных
        const assignment = line.match(
          /^\+([A-Za-z_]\w*)\s*=\s*(.+?)\s*:?$/
        );

        if (assignment) {
          setVariable(
            assignment[1],
            getValue(assignment[2])
          );
          continue;
        }

        // Математика
        const math = line.match(
          /^&Math\.([A-Za-z_]\w*)\s+(.+?)\s*:?$/
        );

        if (math) {
          setVariable(
            math[1],
            evaluateMath(math[2])
          );
          continue;
        }

        // Вывод
        const say = line.match(
          /^Say\s*\(([\s\S]*?)\)\s*:?\s*$/
        );

        if (say) {
          messages.push(String(getValue(say[1])));
          continue;
        }

        // Поиск текста
        const search = line.match(
          /^&finin\.([A-Za-z_]\w*)\("([\s\S]*)"\)\s*:?$/
        );

        if (search) {
          fininResult = String(
            getValue(search[1])
          ).includes(search[2]);

          debug.push(`Результат поиска: ${fininResult}`);
          continue;
        }

        // Округление
        const rounding = line.match(
          /^&okrug(U?)\.([A-Za-z_]\w*)(?:\\vyv\/)?\s*(?:~|=)\s*([A-Za-z_]\w*)\s*:?$/
        );

        if (rounding) {
          const value = Number(getValue(rounding[2]));

          if (!Number.isFinite(value)) {
            fail("Для округления нужно число.");
          }

          const result = rounding[1]
            ? Math.floor(value)
            : Math.round(value);

          setVariable(rounding[3], result);
          continue;
        }

        // Подсчёт букв, цифр и символов
        const count = line.match(
          /^&(bulist|tzilist|symblist)\.([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*)\s*:?$/
        );

        if (count) {
          const value = String(getValue(count[2]));
          let selected;

          if (count[1] === "bulist") {
            selected = [...value].filter(ch => /\p{L}/u.test(ch));
          } else if (count[1] === "tzilist") {
            selected = [...value].filter(ch => /\d/.test(ch));
          } else {
            selected = [...value].filter(
              ch => !/[\p{L}\d\s]/u.test(ch)
            );
          }

          setVariable(
            count[3],
            `${selected.length}(${selected.join(",")})`
          );

          continue;
        }

        // Замена текста
        const conversion = line.match(
          /^&\((bu|tzi|symb|01)\)re\.([A-Za-z_]\w*)\("([\s\S]*?)"\s*,\s*"([\s\S]*?)"\)\s*(?:~|=)\s*([A-Za-z_]\w*)\s*:?$/
        );

        if (conversion) {
          const [
            ,
            type,
            sourceName,
            searchText,
            replacement,
            destination
          ] = conversion;

          const value = String(getValue(sourceName));
          const result = value.replace(searchText, replacement);

          setVariable(destination, result);
          debug.push(`Преобразование ${type} выполнено.`);
          continue;
        }

        // Добавление текста
        const addText = line.match(
          /^add1\.([A-Za-z_]\w*)\((str|ctr)\.(\d+)\s*,\s*"([\s\S]*?)"\)\s*=\s*"([\s\S]*?)"\s*:?$/
        );

        if (addText) {
          const [
            ,
            sourceName,
            mode,
            positionText,
            insertion,
            destination
          ] = addText;

          const value = String(getValue(sourceName));

          const index = Math.max(
            0,
            Math.min(value.length, Number(positionText) - 1)
          );

          const result = mode === "str"
            ? value.slice(0, index + 1) + insertion + value.slice(index + 1)
            : value.slice(0, index) + insertion + value.slice(index);

          setVariable(destination, result);
          continue;
        }

        // Условия и вложенные условия
        if (/^\*if\d*\s+/.test(line)) {
          const structure = parseConditionStructure(i, end);

          const conditionMatch = structure.header.match(
            /^\*(if\d*)\s+'([\s\S]*?)'\s*;\)?$/
          );

          if (!conditionMatch) {
            fail("Проверь синтаксис условия.");
          }

          const conditionName = conditionMatch[1];

          const matches = evaluateCondition(
            conditionMatch[2],
            conditionName
          );

          if (matches) {
            const control = runBlock(
              structure.thenStart,
              structure.thenEnd
            );

            if (control) return control;
          } else if (structure.elseHeader) {
            const control = runBlock(
              structure.elseStart,
              structure.elseEnd
            );

            if (control) return control;
          }

          i = structure.nextIndex - 1;
          continue;
        }

        // *not if вне связанного условия
        if (line.startsWith("*not if")) {
          fail("*not if должен следовать после ветви *if.");
        }

        // Бесконечные циклы Temocus
        if (line === "#cycleX") {
          if (cycleActive) {
            fail("Вложенные циклы пока не поддерживаются.");
          }

          cycleActive = true;

          while (!halted) {
            steps++;

            if (steps > MAX_STEPS) {
              errors.push(
                "Превышен лимит команд. Возможно, цикл бесконечный."
              );

              halted = true;
              break;
            }

            const control = runBlock(i + 1, end);

            if (control === "breakcycle") {
              break;
            }

            if (control === "restart") {
              continue;
            }

            break;
          }

          cycleActive = false;
          return null;
        }

        // Перезапуск цикла
        if (line === "#X") {
          if (!cycleActive) {
            fail("Команда #X находится вне цикла.");
          }

          return "restart";
        }

        // Выход из цикла
        if (line === "#breakcycleX") {
          if (!cycleActive) {
            fail("Команда #breakcycleX находится вне цикла.");
          }

          return "breakcycle";
        }

        // Старые циклы с повторениями
        const loop = line.match(
          /^&plrep(u)?\.([A-Za-z_]\w*)\((\d+)\)\s*;\)?$/
        );

        if (loop) {
          const close = findLoopClosing(i + 1, end);

          if (close === -1) {
            fail("Не найдено закрытие цикла ;(.");
          }

          const count = Number(loop[3]);

          for (let n = 0; n < count && !halted; n++) {
            const control = runBlock(i + 1, close);

            if (control) return control;
          }

          i = close;
          continue;
        }

        // Паузы
        const pause = line.match(/^[*-]stop\.(\d+)\s*:?$/);

        if (pause) {
          fail("Паузы пока не поддерживаются.");
        }

        // Секретная консоль
        if (line.includes("\\vyv/")) {
          debug.push(`Секретная консоль: ${line}`);
          continue;
        }

        fail("Неизвестная команда.");

      } catch (error) {
        errors.push(`Строка ${i + 1}: ${error.message}`);
      }
    }

    return null;
  }

  // Поиск начала программы
  const start = lines.findIndex(
    line => line.trim() === "!TCS"
  );

  if (start === -1) {
    return {
      messages,
      debug,
      errors: ["Не найдено начало программы: !TCS"]
    };
  }

  // Поиск конца программы
  const end = lines.findIndex(
    (line, index) => index > start && line.trim() === "TCS!"
  );

  if (end === -1) {
    return {
      messages,
      debug,
      errors: ["Не найден конец программы: TCS!"]
    };
  }

  runBlock(start + 1, end);

  return {
    messages,
    debug,
    errors
  };
}

// =====================================
// TEMOCUS PLATFORM — INTERFACE
// =====================================

const pages = {
  studio: document.getElementById("studioPage"),
  ideas: document.getElementById("ideasPage"),
  store: document.getElementById("storePage"),
  ai: document.getElementById("aiPage")
};

const navButtons = document.querySelectorAll("[data-page]");

function openPage(name) {
  if (!pages[name]) return;

  Object.values(pages).forEach(page => {
    page.classList.remove("active");
  });

  pages[name].classList.add("active");

  navButtons.forEach(button => {
    button.classList.toggle(
      "active",
      button.dataset.page === name
    );
  });
}

navButtons.forEach(button => {
  button.addEventListener("click", () => {
    openPage(button.dataset.page);
  });
});

// =====================================
// TEMOCUS STUDIO — RUN
// =====================================
if (runButton && codeEditor && output && secret) {
  runButton.addEventListener("click", () => {
    try {
      const result = runTemocus(codeEditor.value);

      output.textContent = result.messages.length
        ? result.messages.join("\n")
        : "Программа завершилась без вывода.";

      const debugLines = [...result.debug];

      if (result.errors.length) {
        debugLines.push("");
        debugLines.push("ОШИБКИ:");
        debugLines.push(...result.errors);
      }

      secret.textContent = debugLines.length
        ? debugLines.join("\n")
        : "Запуск завершён. Отладочных сообщений нет.";

    } catch (error) {
      output.textContent = "Ошибка запуска Temocus.";
      secret.textContent = error.message;
      console.error(error);
    }
  });
} else {
  console.error("TEMOCUS RUN: Не найдены необходимые HTML-элементы.");
}

// =====================================
// THEME — DARK / LIGHT
// =====================================

const themeButton = document.getElementById("themeButton");

themeButton.addEventListener("click", () => {
  document.body.classList.toggle("light");

  themeButton.textContent =
    document.body.classList.contains("light") ? "☾" : "☼";
});

// =====================================
// TEMOCUS AI — HOVER PRICE
// =====================================

const aiButton = document.getElementById("aiButton");
const aiLabel = document.getElementById("aiLabel");

let aiPurchased = false;

aiButton.addEventListener("mouseenter", () => {
  if (!aiPurchased) {
    aiLabel.textContent = "$0.99";
  }
});

aiButton.addEventListener("mouseleave", () => {
  aiLabel.textContent = "AI";
});

// =====================================
// PAYMENT WINDOW — DEMO ONLY
// =====================================

const paymentModal = document.getElementById("paymentModal");
const paymentTitle = document.getElementById("paymentTitle");
const paymentDescription = document.getElementById("paymentDescription");

const cancelPayment = document.getElementById("cancelPayment");
const confirmPayment = document.getElementById("confirmPayment");

let paymentType = null;

function openPayment(type) {
  paymentType = type;

  if (type === "ai") {
    paymentTitle.textContent = "TEMOCUS AI";
    paymentDescription.textContent =
      "Покупка Temocus AI за $0.99. Это демонстрация — реальные платежи пока не подключены.";
  }

  if (type === "idea") {
    paymentTitle.textContent = "TEMOCUS IDEAS";
    paymentDescription.textContent =
      "Отправка идеи стоит $0.09. Это демонстрация — реальные платежи пока не подключены.";
  }

  paymentModal.classList.add("show");
}

function closePayment() {
  paymentModal.classList.remove("show");
  paymentType = null;
}

cancelPayment.addEventListener("click", closePayment);

confirmPayment.addEventListener("click", () => {
  if (paymentType === "ai") {
    alert("Платёжная система пока не подключена.");
  }

  if (paymentType === "idea") {
    alert("Отправка идей пока находится в разработке.");
  }

  closePayment();
});

aiButton.addEventListener("click", () => {
  if (!aiPurchased) {
    openPayment("ai");
  } else {
    openPage("ai");
  }
});

// =====================================
// IDEAS — SEND
// =====================================

const ideaInput = document.getElementById("ideaInput");
const sendIdea = document.getElementById("sendIdea");

sendIdea.addEventListener("click", () => {
  if (!ideaInput.value.trim()) {
    alert("Сначала напиши свою идею!");
    return;
  }

  openPayment("idea");
});

// =====================================
// TEMOCUS AI — CHAT INTERFACE
// =====================================

const aiInput = document.getElementById("aiInput");
const sendAI = document.getElementById("sendAI");
const chatMessages = document.getElementById("chatMessages");

function sendAIMessage() {
  const question = aiInput.value.trim();

  if (!question) return;

  const userMessage = document.createElement("div");
  userMessage.className = "chat-user";
  userMessage.textContent = question;

  chatMessages.appendChild(userMessage);

  const response = document.createElement("div");
  response.className = "chat-placeholder";
  response.textContent =
    "Temocus AI пока не подключён. Интерфейс чата готов к подключению AI.";

  chatMessages.appendChild(response);

  aiInput.value = "";
}

sendAI.addEventListener("click", sendAIMessage);

aiInput.addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendAIMessage();
  }
});

console.log("TEMOCUS PLATFORM — INTERFACE LOADED");
