// -----------------------------------------------------------------------------
// Minimal XML reader for the Roku ECP responses.
//
// ECP answers small, flat documents (device-info, apps, active-app,
// media-player): elements, attributes, text, the XML declaration and, in our
// fixtures, comments. A full XML library would be the heaviest dependency of
// the integration for that; this reader covers exactly that subset, and is
// tolerant: what it does not understand (DTD, processing instructions,
// CDATA-free text with stray characters) is skipped, never thrown on, except a
// document with no root element at all.
// -----------------------------------------------------------------------------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/**
 * Decode the XML entities of a text or attribute value.
 *
 * @param {string} text Raw text.
 * @returns {string} Decoded text.
 */
export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === '#') {
      const code =
        entity[1] === 'x' || entity[1] === 'X'
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

function parseAttributes(source) {
  const attrs = {};
  const pattern = /([^\s=/]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    attrs[match[1]] = decodeEntities(match[3] ?? match[4] ?? '');
  }
  return attrs;
}

/**
 * Parse an XML document into a tree of `{ name, attrs, children, text }`.
 * `text` is the trimmed concatenation of the element's own text nodes.
 *
 * @param {string} xml The document.
 * @returns {{ name: string, attrs: Object, children: Array, text: string }} The root element.
 */
export function parseXml(xml) {
  const source = String(xml ?? '');
  const root = { name: '#document', attrs: {}, children: [], text: '' };
  const stack = [root];
  const tagPattern = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<![^>]*>|<\/?[^>]+>/g;
  let cursor = 0;
  let match;
  while ((match = tagPattern.exec(source)) !== null) {
    const current = stack[stack.length - 1];
    current.text += source.slice(cursor, match.index);
    cursor = match.index + match[0].length;
    const tag = match[0];
    if (tag.startsWith('<!') || tag.startsWith('<?')) {
      continue;
    }
    if (tag.startsWith('</')) {
      const name = tag.slice(2, -1).trim();
      // Pop up to the matching element: a stray closing tag is ignored.
      const index = stack.map((element) => element.name).lastIndexOf(name);
      if (index > 0) {
        stack.length = index;
      }
      continue;
    }
    const selfClosing = tag.endsWith('/>');
    const inner = tag.slice(1, selfClosing ? -2 : -1).trim();
    const nameEnd = inner.search(/\s/);
    const name = nameEnd < 0 ? inner : inner.slice(0, nameEnd);
    const element = {
      name,
      attrs: nameEnd < 0 ? {} : parseAttributes(inner.slice(nameEnd)),
      children: [],
      text: '',
    };
    current.children.push(element);
    if (!selfClosing) {
      stack.push(element);
    }
  }
  const finalize = (element) => {
    element.text = decodeEntities(element.text.trim());
    element.children.forEach(finalize);
  };
  finalize(root);
  const [documentElement] = root.children;
  if (!documentElement) {
    throw new Error('Not an XML document');
  }
  return documentElement;
}

/**
 * The first child element with this name.
 *
 * @param {Object} element Parent element.
 * @param {string} name Child name.
 * @returns {Object|undefined} The child.
 */
export function child(element, name) {
  return element?.children.find((candidate) => candidate.name === name);
}

/**
 * The text of the first child element with this name.
 *
 * @param {Object} element Parent element.
 * @param {string} name Child name.
 * @returns {string|undefined} Its text, undefined when absent.
 */
export function childText(element, name) {
  return child(element, name)?.text;
}
