/**
 * <md-block> custom element
 * @author Lea Verou, Multivalence and hannahilea
 * Note that hannahilea is the original author of the footnote support and i simply merged the changes with the ones by Multivalence - jmb | July 13, 2026 | 00:38
 */

import { marked } from 'https://cdn.jsdelivr.net/npm/marked@15.0.7/lib/marked.esm.js';

// Configure marked to handle nested markdown
marked.setOptions({
	headerIds: true,
	mangle: false,
	headerPrefix: '',
	gfm: true
});

// Custom extensions for underlines
const underlineExtension = {
	name: 'underline',
	level: 'inline',
	start(src) { return src.match(/__/)?.index; },
	tokenizer(src) {
		const match = src.match(/^__([^_]+)__/);
		if (match) {
			return {
				type: 'underline',
				raw: match[0],
				text: match[1]
			};
		}
		return false;
	},
	renderer(token) {
		return `<u>${token.text}</u>`;
	}
};

// Add the extension to marked
marked.use({ extensions: [underlineExtension] });

let DOMPurify = window.DOMPurify;
let Prism = window.Prism;


class SimpleSlugger {
	constructor() {
		this.seen = {};
	}
	slug(text) {
		let slug = text.toString().toLowerCase().trim().replace(/[^\w]+/g, '-');
		if (this.seen[slug]) {
			slug += '-' + this.seen[slug]++;
		} else {
			this.seen[slug] = 1;
		}
		return slug;
	}
}

export const URLs = {
	DOMPurify: "https://cdn.jsdelivr.net/npm/dompurify@2.3.4/dist/purify.es.min.js"
};

// Fix indentation
function deIndent(text) {
	let indent = text.match(/^[\r\n]*([\t ]+)/);

	if (indent) {
		indent = indent[1];

		text = text.replace(RegExp("^" + indent, "gm"), "");
	}

	return text;
}

// Handle footnote support
function handleFootnotes(text) {
	// Find all footnotes; must have a newline before and after them
	let footnotes = text.match(/<p>[ \t]*\[\^[A-Za-z0-9]+\]:.*[ \t\n]*<\/p>/g);
	if (footnotes === null) {
		return text;
	}

	// Strip all footnotes from the text:
	footnotes.forEach(f => {
		text = text.replace(f, "");
	})
	let footnotesClean = footnotes.map(function (f) {
		return f.substring(3, f.length - 4);
	});

	// Find all footnote references
	let footnoteRefs = text.match(/\[\^[A-Za-z0-9]+\](?!:)/g);
	if (footnoteRefs === null) {
		return text;
	}

	// Only treat candidate refs as footnote refs if they have a corresponding footnote 
	let refSymbols = footnoteRefs.map(function (r) { return r.substring(2, r.length - 1); });
	let footnoteSymbols = footnotesClean.map(function (r) {
		r = r.split(":")[0];  // [^foo]
		return r.substring(2, r.length - 1)  // foo
	});
	let validRefSymbols = refSymbols.filter((r) => footnoteSymbols.includes(r));
	// ...and make sure those references are unique
	validRefSymbols = Array.from(new Set(validRefSymbols))

	// Only include the first footnotes for each reference
	let validFootnotes = validRefSymbols.map(function (s) {
		let i = footnoteSymbols.findIndex(function (fn) { return fn === s; });
		return footnotes[i];
	});

	// Now our lists of references and footnotes are all ordered correctly!
	// First, let's set up the footnote footer 
	let footnoteFooter = '\n<div class="footnotes">\n\t<hr class="footnote-div">'

	validRefSymbols.forEach((symbol, i) => {
		// Let's add the footnote itself first
		let footnote = validFootnotes[i];
		let content = footnote.split(":")[1];
		content = content.substring(0, content.length - 4).trim();

		let iRef = i + 1;
		let footnoteHTML = "\n\t<p>" + iRef + ". " + content;

		// It is possible for multiple references to point to the same footnote,
		// so we need to give them each unique ids
		let r = RegExp(String.raw`\[\^${symbol}\]`, "g")
		let numRefs = text.match(r).length;
		for (let iSymbol = 0; iSymbol < numRefs; iSymbol++) {
			let uniqueRef = numRefs > 1 ? iRef + "-" + (iSymbol + 1) : iRef;

			// Update the footnote reference
			let footnoteSuperscript = '<sup><a class="footnote-ref" href="#footnote-' +
				uniqueRef + '" id="footnote-' + uniqueRef + '-ref">' +
				iRef + '</a></sup>';
			text = text.replace("[^" + symbol + "]", footnoteSuperscript);

			// Add the footnote linkback
			let linkback = '<a class="footnote" href="#footnote-' + uniqueRef +
				'-ref" id="footnote-' + uniqueRef + '">↩</a>'
			footnoteHTML += linkback;
		}
		footnoteFooter += footnoteHTML + "</p>";
	})

	// ...and close out the footnote footer:
	footnoteFooter += "\n</div>"

	text += footnoteFooter;

	return text;
}

export class MarkdownElement extends HTMLElement {
	constructor() {
		super();

		// Create a shallow copy of the static renderer and bind its methods.
		this.renderer = Object.assign({}, this.constructor.renderer);
		for (let property in this.renderer) {
			this.renderer[property] = this.renderer[property].bind(this);
		}
	}

	get rendered() {
		return this.getAttribute("rendered");
	}

	get mdContent() {
		return this._mdContent;
	}

	set mdContent(html) {
		this._mdContent = html;
		this._contentFromHTML = false;
		this.render();
	}

	connectedCallback() {
		Object.defineProperty(this, "untrusted", {
			value: this.hasAttribute("untrusted"),
			enumerable: true,
			configurable: false,
			writable: false
		});

		if (this._mdContent === undefined) {
			this._contentFromHTML = true;
			this._mdContent = deIndent(this.innerHTML);
			// marked expects markdown quotes (>) to be un-escaped, otherwise they won't render correctly
			this._mdContent = this._mdContent.replace(/&gt;/g, '>');
		}

		this.render();
	}

	async render() {
		if (!this.isConnected || this._mdContent === undefined) {
			return;
		}

		// Use the element's custom renderer
		marked.use({
			langPrefix: "language-",
			renderer: this.renderer
		});

		let html = this._parse();

		if (this.untrusted) {
			let mdContent = this._mdContent;
			html = await MarkdownElement.sanitize(html);
			if (this._mdContent !== mdContent) {
				// While we were running this async call, the content changed. Abort mission!
				return;
			}
		}

		html = handleFootnotes(html);

		this.innerHTML = html;

		if (!Prism && URLs.Prism && this.querySelector("code")) {
			Prism = import(URLs.Prism);
			if (URLs.PrismCSS) {
				let link = document.createElement("link");
				link.rel = "stylesheet";
				link.href = URLs.PrismCSS;
				document.head.appendChild(link);
			}
		}

		if (Prism) {
			await Prism; // in case it's still loading
			Prism.highlightAllUnder(this);
		}

		if (this.src) {
			this.setAttribute("rendered", this._contentFromHTML ? "fallback" : "remote");
		} else {
			this.setAttribute("rendered", this._contentFromHTML ? "content" : "property");
		}

		// Fire event
		let event = new CustomEvent("md-render", { bubbles: true, composed: true });
		this.dispatchEvent(event);
	}

	static async sanitize(html) {
		if (!DOMPurify) {
			DOMPurify = import(URLs.DOMPurify).then(m => m.default);
		}
		DOMPurify = await DOMPurify; // in case it's still loading
		return DOMPurify.sanitize(html);
	}
}

export class MarkdownSpan extends MarkdownElement {
	constructor() {
		super();
	}

	_parse() {
		return marked.parseInline(this._mdContent);
	}

	static renderer = {
		codespan(code) {
			if (code.text !== undefined) {
				code = code.text
			} else {
				return `<code>""</code>`;
			}
			if (this._contentFromHTML) {
				// Inline HTML code needs to be escaped to not be parsed as HTML by the browser.
				// Marked double-escapes it, so we need to unescape it.
				code = code.toString().replace(/&amp;(?=[lg]t;)/g, "&");
			} else {
				// Remote code may include characters that need to be escaped to be visible in HTML.
				code = code.toString().replace(/</g, "&lt;");
			}
			return `<code>${code}</code>`;
		}
	}
}

export class MarkdownBlock extends MarkdownElement {
	constructor() {
		super();
	}

	get src() {
		return this._src;
	}

	set src(value) {
		this.setAttribute("src", value);
	}

	get hmin() {
		return this._hmin || 1;
	}

	set hmin(value) {
		this.setAttribute("hmin", value);
	}

	get hlinks() {
		return this._hlinks ?? null;
	}

	set hlinks(value) {
		this.setAttribute("hlinks", value);
	}

	_parse() {
		return marked.parse(this._mdContent);
	}

	static renderer = Object.assign({
		heading(obj) {
			let { depth, text, raw } = obj;
			// Parse the heading text to handle nested markdown
			const headingText = marked.parseInline(raw.slice(depth + 1));

			depth = Math.min(6, depth + (this.hmin - 1));

			// Create a slugger instance (a shared instance would be better if you have multiple headings)
			const slugger = new SimpleSlugger();
			const id = slugger.slug(text);

			let hlinks = this.hlinks;
			let content;

			if (hlinks === null) {
				content = headingText;
			} else {
				content = `<a href="#${id}" class="anchor">`;
				if (hlinks === "") {
					content += headingText + "</a>";
				} else {
					content += hlinks + "</a>" + headingText;
				}
			}
			return `<h${depth} id="${id}">${content}</h${depth}>`;
		},

		// Add table rendering support
		table(obj) {
			// Generate header
			const headerCells = obj.header.map((cell, i) => {
				const alignAttr = obj.align[i] ? ` align="${obj.align[i]}"` : '';
				return `<th${alignAttr}>${cell.text}</th>`;
			}).join('');
			const header = `<tr>${headerCells}</tr>`;

			// Generate rows
			const rows = obj.rows.map(row => {
				const cells = row.map((cell, i) => {
					const alignAttr = obj.align[i] ? ` align="${obj.align[i]}"` : '';
					return `<td${alignAttr}>${cell.text}</td>`;
				}).join('');
				return `<tr>${cells}</tr>`;
			}).join('');

			return `<table class="table">
				<thead>${header}</thead>
				<tbody>${rows}</tbody>
			</table>`;
		},

		tablerow(obj) {
			return obj.content;
		},

		tablecell(obj) {
			return obj.content;
		},

		code(code) {
			
			if (code.text !== undefined) {
				code = code.text;
			} else {
				return `<pre><code></code></pre>`;
			}

			if (this._contentFromHTML) {
				// Inline HTML code needs to be escaped to not be parsed as HTML by the browser.
				// Marked double-escapes it, so we need to unescape it.
				code = code.replace(/&amp;(?=[lg]t;)/g, "&");
			} else {
				// Remote code may include characters that need to be escaped to be visible in HTML.
				code = code.replace(/</g, "&lt;");
			}
			return `<pre><code>${code}</code></pre>`;
		}
	}, MarkdownSpan.renderer);

	static get observedAttributes() {
		return ["src", "hmin", "hlinks"];
	}

	attributeChangedCallback(name, oldValue, newValue) {
		if (oldValue === newValue) {
			return;
		}

		switch (name) {
			case "src":
				let url;
				try {
					url = new URL(newValue, location);
				} catch (e) {
					return;
				}

				let prevSrc = this.src;
				this._src = url;

				if (this.src !== prevSrc) {
					fetch(this.src)
						.then(response => {
							if (!response.ok) {
								throw new Error(`Failed to fetch ${this.src}: ${response.status} ${response.statusText}`);
							}
							return response.text();
						})
						.then(text => {
							this.mdContent = text;
						})
						.catch(e => { });
				}
				break;
			case "hmin":
				if (newValue > 0) {
					this._hmin = +newValue;
					this.render();
				}
				break;
			case "hlinks":
				this._hlinks = newValue;
				this.render();
		}
	}
}

customElements.define("md-block", MarkdownBlock);
customElements.define("md-span", MarkdownSpan);
