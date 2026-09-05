const HTML_ESCAPE_MAP = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
};

const LATEX_COMMANDS = {
    '\\times': '×',
    '\\cdot': '·',
    '\\div': '÷',
    '\\pm': '±',
    '\\le': '≤',
    '\\leq': '≤',
    '\\ge': '≥',
    '\\geq': '≥',
    '\\neq': '≠',
    '\\approx': '≈',
    '\\infty': '∞',
    '\\rightarrow': '→',
    '\\to': '→',
    '\\left': '',
    '\\right': ''
};

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => HTML_ESCAPE_MAP[character]);
}

function formatLatexGroup(value) {
    return formatLatexMath(value, false);
}

function formatLatexMath(value, display) {
    let html = escapeHtml(value).trim();

    // Handle the most useful grouped commands before removing grouping braces.
    let previous;
    do {
        previous = html;
        html = html
            .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, (_match, numerator, denominator) =>
                `<span class="math-fraction"><span>${formatLatexGroup(numerator)}</span><span>${formatLatexGroup(denominator)}</span></span>`
            )
            .replace(/\\sqrt\{([^{}]*)\}/g, (_match, content) =>
                `<span class="math-root"><span>√</span><span>${formatLatexGroup(content)}</span></span>`
            )
            .replace(/\\(?:text|mathrm|mathbf)\{([^{}]*)\}/g, '$1');
    } while (html !== previous);

    Object.entries(LATEX_COMMANDS)
        .sort(([firstCommand], [secondCommand]) => secondCommand.length - firstCommand.length)
        .forEach(([command, replacement]) => {
        html = html.split(command).join(replacement);
        });

    html = html
        .replace(/\\(log|ln|sin|cos|tan|max|min|exp)\b/g, '$1')
        .replace(/\\[,;:!]/g, ' ')
        .replace(/\\([{}()[\]])/g, '$1');

    // Convert simple TeX superscript/subscript expressions to real HTML so
    // values such as 2^{31} remain readable at the compact chat font size.
    let last;
    do {
        last = html;
        html = html
            .replace(/([A-Za-z]+|[0-9]+|[)\]])\^\{([^{}]+)\}/g, '$1<sup>$2</sup>')
            .replace(/([A-Za-z]+|[0-9]+|[)\]])\^([A-Za-z0-9+\-])/g, '$1<sup>$2</sup>')
            .replace(/([A-Za-z]+|[0-9]+|[)\]])_\{([^{}]+)\}/g, '$1<sub>$2</sub>')
            .replace(/([A-Za-z]+|[0-9]+|[)\]])_([A-Za-z0-9+\-])/g, '$1<sub>$2</sub>');
    } while (html !== last);

    html = html.replace(/[{}]/g, '');

    const className = display ? 'math-display' : 'math-inline';
    return display ? `<div class="${className}">${html}</div>` : `<span class="${className}">${html}</span>`;
}

/**
 * Format the lightweight Markdown/LaTeX syntax commonly returned by the AI.
 * The output is intended for innerHTML and all user/AI text is escaped first.
 */
export function formatAiResponse(text, { includeCodeCopyButton = true } = {}) {
    const codeBlocks = [];
    const mathExpressions = [];
    let processedText = String(text ?? '');

    processedText = processedText.replace(/```[^\r\n]*\r?\n([\s\S]*?)```/g, (_match, code) => {
        const rawCode = String(code).trim();
        const encodedCode = encodeURIComponent(rawCode);
        const copyButton = includeCodeCopyButton
            ? `<button class="code-copy-btn" data-code="${encodedCode}" type="button" title="Copy Code">Copy</button>`
            : '';
        codeBlocks.push(
            `<div class="code-block-wrapper">${copyButton}<pre><code>${escapeHtml(rawCode)}</code></pre></div>`
        );
        return `@@CODE_BLOCK_${codeBlocks.length - 1}@@`;
    });

    // Extract math before escaping and Markdown formatting. This prevents
    // underscores, asterisks, and braces inside formulas from being altered.
    processedText = processedText.replace(
        /\$\$([\s\S]*?)\$\$|\\\[([\s\S]*?)\\\]|\\\(([\s\S]*?)\\\)|(?<!\\)\$([^$\r\n]+?)(?<!\\)\$/g,
        (_match, displayDollar, displayBracket, inlineParen, inlineDollar) => {
            const isDisplay = displayDollar !== undefined || displayBracket !== undefined;
            const expression = displayDollar ?? displayBracket ?? inlineParen ?? inlineDollar;
            mathExpressions.push(formatLatexMath(expression, isDisplay));
            return `@@MATH_${mathExpressions.length - 1}@@`;
        }
    );

    processedText = escapeHtml(processedText)
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/\r?\n/g, '<br>');

    mathExpressions.forEach((expression, index) => {
        processedText = processedText.replace(`@@MATH_${index}@@`, expression);
    });
    codeBlocks.forEach((block, index) => {
        processedText = processedText.replace(`@@CODE_BLOCK_${index}@@`, block);
    });

    return processedText;
}
