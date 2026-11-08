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

    // Ответы пользователя
    if (text === "{human.otv}") return inputs[0] ?? "";
    if (text === "{human.otv}.second2") return inputs[1] ?? "";
    if (text === "{human.otv}.third3") return inputs[2] ?? "";

    // .upper — последний введённый ответ
    if (
      text === ".upper" ||
      text === "{human.otv}.upper"
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

  // Разделение логических выражений без разделения текста в кавычках
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

  // Проверки Temocus: if, if2, if3 и другие
  function evaluateCondition(condition, conditionName = "if") {
    condition = condition.trim();

    if (/^not\s+/i.test(condition)) {
      return !evaluateCondition(
        condition.replace(/^not\s+/i, ""),
        conditionName
      );
    }

    if (/^Not\s+/i.test(condition)) {
      return !evaluateCondition(
        condition.replace(/^Not\s+/i, ""),
        conditionName
      );
    }

    const andParts = splitLogical(condition, ",.");

    if (andParts.length > 1) {
      let result = true;

      for (const part of andParts) {
        if (!evaluateCondition(part, conditionName)) {
          result = false;
          break;
        }
      }

      return result;
    }

    const orParts = splitLogical(condition, "o.r");

    if (orParts.length > 1) {
      let result = false;

      for (const part of orParts) {
        if (evaluateCondition(part, conditionName)) {
          result = true;
          break;
        }
      }

      return result;
    }

    condition = condition.replace(/^['"]|['"]$/g, "").trim();

    // Левая часть может быть [переменная] или выражением .upper
    const match = condition.match(
      /^(\[[^\]]+\]|\{human\.otv\}(?:\.(?:second2|third3|upper))?|\.upper)\s*(>\.=|<\.=|≠@|@≠|@=|=@|>=|<=|>|<)\s*(.+?)\s*$/
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

    // Ссылки на сохранённые условия: {if}, {if2}, {if3}...
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

  // Поиск закрывающей скобки условия
  function findClosing(start, open, close, limit = lines.length) {
    let depth = 0;

    for (let i = start; i < limit; i++) {
      const line = lines[i].trim();

      if (open === "*if") {
        if (isConditionHeader(line)) {
          depth++;
        }
      } else if (line.startsWith(open)) {
        depth++;
      }

      if (line === close) {
        depth--;

        if (depth === 0) return i;
      }
    }

    return -1;
  }

  // Разбор ветвей одного условия
  function getConditionBranches(start, close) {
    const branches = [];
    let branchHeader = lines[start].trim();
    let branchStart = start + 1;

    let j = start + 1;

    while (j < close) {
      const current = lines[j].trim();

      if (isConditionHeader(current)) {
        const previous = j > start
          ? lines[j - 1].trim()
          : "";

        // Условие после ;( — следующая ветвь
        if (previous === ";(") {
          branches.push({
            header: branchHeader,
            start: branchStart,
            end: j - 1
          });

          branchHeader = current;
          branchStart = j + 1;
          j++;
          continue;
        }

        // Вложенное условие — пропускаем его целиком
        const nestedClose = findClosing(j, "*if", ":(", close + 1);

        if (nestedClose === -1) {
          fail("Не найдено закрытие вложенного условия :(.");
        }

        j = nestedClose + 1;
        continue;
      }

      j++;
    }

    branches.push({
      header: branchHeader,
      start: branchStart,
      end: close
    });

    return branches;
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

      if (!line || line.startsWith("//") || line === ";(") {
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
        // Знак = здесь используется только для присваивания
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

        // Условия
        if (isConditionHeader(line)) {
          const close = findClosing(i, "*if", ":(", end);

          if (close === -1) {
            fail("Не найдено закрытие условия :(.");
          }

          const branches = getConditionBranches(i, close);
          let chosen = false;

          for (const branch of branches) {
            let matches = false;

            if (branch.header.startsWith("*not if")) {
              matches = !chosen;
            } else {
              const conditionMatch = branch.header.match(
                /^\*(if\d*)\s+'([\s\S]*?)'\s*;\)?$/
              );

              if (!conditionMatch) {
                fail("Проверь синтаксис условия.");
              }

              const conditionName = conditionMatch[1];

              matches = !chosen && evaluateCondition(
                conditionMatch[2],
                conditionName
              );
            }

            if (matches) {
              chosen = true;

              const control = runBlock(
                branch.start,
                branch.end
              );

              if (control) return control;
            }

            if (halted) break;
          }

          i = close;
          continue;
        }

        // Циклы Temocus
        if (line === "#cycleX") {
          if (cycleActive) {
            fail("Вложенные циклы пока не поддерживаются.");
          }

          cycleActive = true;

          let cycleResult = null;

          while (!halted) {
            steps++;

            if (steps > MAX_STEPS) {
              errors.push(
                "Превышен лимит команд. Возможно, цикл бесконечный."
              );

              halted = true;
              break;
            }

            cycleResult = runBlock(i + 1, end);

            if (cycleResult === "breakcycle") {
              break;
            }

            if (cycleResult === "restart") {
              continue;
            }

            // Если цикл дошёл до конца без #X,
            // повторять его автоматически не нужно.
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
          const close = findClosing(i, "&plrep", ";(", end);

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

// Запуск программы
runButton.addEventListener("click", () => {
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
});
