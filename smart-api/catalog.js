// What we make, read from the site's own data (white/src/products.js), so the assistant and the site
// never disagree. In the image the file is copied next to this one; in the repo it is read from white/src/.
const fs = require("fs");
const path = require("path");

function findProducts(explicit) {
  const tries = [explicit, path.join(__dirname, "products.js"), path.join(__dirname, "..", "white", "src", "products.js")];
  return tries.find((p) => p && fs.existsSync(p)) || null;
}

function loadCatalog(file) {
  const found = findProducts(file);
  if (!found) return { groups: [], items: [], support: null, works: [] };
  const P = require(found);
  const item = (i) => ({ slug: i.slug, group: i.group, name: i.name, card: i.card || i.line || "", fit: i.fit || [] });
  return {
    groups: (P.groups || []).map((g) => ({ id: g.id, name: g.name })),
    items: (P.items || []).map(item),
    support: P.support ? item(P.support) : null,
    works: (P.apps || []).map((a) => ({ name: a.name, tag: a.tag, line: a.line })),
  };
}

// Every service name the assistant may name: the products plus support.
function serviceNames(catalog) {
  return catalog.items.map((i) => i.name).concat(catalog.support ? [catalog.support.name] : []);
}

// «Клиенты пишут вам в Telegram» → «клиенты пишут вам в Telegram», but «ИИ-сервис» stays as it is
function lowerFirst(s) {
  s = String(s || "");
  return s.length > 1 && s[1] === s[1].toUpperCase() && s[1] !== s[1].toLowerCase() ? s : s.charAt(0).toLowerCase() + s.slice(1);
}

// The services as plain lines for the prompt, grouped as on the site.
function servicesText(catalog) {
  const lines = [];
  for (const g of catalog.groups) {
    lines.push(g.name + ":");
    for (const i of catalog.items.filter((x) => x.group === g.id)) {
      lines.push("- " + i.name + ". " + i.card + (i.fit.length ? " Подходит, если: " + i.fit.map(lowerFirst).join("; ") + "." : ""));
    }
  }
  if (catalog.support) lines.push("После запуска:", "- " + catalog.support.name + ". " + catalog.support.card);
  return lines.join("\n");
}

function worksText(catalog) {
  return catalog.works.map((w) => "- " + w.name + " (" + lowerFirst(w.tag) + "): " + w.line).join("\n");
}

module.exports = { loadCatalog, serviceNames, servicesText, worksText };
