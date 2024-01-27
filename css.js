Object.assign(window, { css, rule, styled: { new: css, rule: rule } });

function scopify_css(uid, css) {
  const virtualDoc = document.implementation.createHTMLDocument("");
  const virtualStyleElement = document.createElement("style");
  virtualDoc.body.appendChild(virtualStyleElement);

  let cssParsed = "";

  virtualStyleElement.textContent = css;

  //@ts-ignore
  for (const rule of virtualStyleElement.sheet.cssRules) {
    rule.selectorText = rule.selectorText.includes("self")
      ? `.${uid}.self${rule.selectorText.replace("self", "")}`
      : `.${uid} ${rule.selectorText}`;
    cssParsed += `${rule.cssText}\n`;
  }

  return cssParsed;
}
function tagcss(strings, values, isblock) {
  const uid = `dream-${Array(16)
    .fill(0)
    .map(() => {
      return Math.floor(Math.random() * 16).toString(16);
    })
    .join("")}`;

  const styleElement = document.createElement("style");

  document.head.appendChild(styleElement);

  const flattened_template = [];
  for (const i in strings) {
    flattened_template.push(strings[i]);
    if (values[i]) {
      const prop = values[i];

      if (isAJSReferences(prop)) {
        const current_i = flattened_template.length;
        let oldparsed;
        handle(prop, (val) => {
          flattened_template[current_i] = String(val);
          let parsed = flattened_template.join("");
          if (parsed != oldparsed)
            if (isblock)
              styleElement.textContent = scopify_css(
                uid,
                parsed,
              );
            else
              styleElement.textContent = `.${uid} { ${parsed}; }`
          oldparsed = parsed;
        });
      } else {
        flattened_template.push(String(prop));
      }
    }
  }

  if (isblock) {
    styleElement.textContent = scopify_css(
      uid,
      flattened_template.join(""),
    );
  } else {
    styleElement.textContent = `.${uid} { ${flattened_template.join("")}; }`
  }

  return uid;
}
export function rule(strings, ...values) {
  return tagcss(strings, values, false)
}
export function css(strings, ...values) {
  return tagcss(strings, values, true);
}

