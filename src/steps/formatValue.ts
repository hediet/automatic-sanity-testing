
export function formatValue(value: unknown, availableLen: number): string {
    switch (typeof value) {
        case 'number':
            return '' + value;
        case 'string':
            if (value.length + 2 <= availableLen) {
                return `"${value}"`;
            }
            return `"${value.substr(0, availableLen - 7)}"+...`;

        case 'boolean':
            return value ? 'true' : 'false';
        case 'undefined':
            return 'undefined';
        case 'object':
            if (value === null) {
                return 'null';
            }
            return formatComposite(value, availableLen);
        case 'symbol':
            return value.toString();
        case 'function':
            return `[[Function${value.name ? ' ' + value.name : ''}]]`;
        default:
            return '' + value;
    }
}

function formatComposite(value: object, availableLen: number): string {
    // Handle objects with custom toString methods
    if (!Array.isArray(value) && typeof value.toString === 'function' && value.toString !== Object.prototype.toString) {
        const val = value.toString();
        if (val.length <= availableLen) {
            return val;
        }
        return val.substring(0, availableLen - 3) + '...';
    }

    // Use a two-pass approach: first pass to estimate sizes, second pass to format
    return formatCompositeWithEstimation(value, availableLen, 0, 5);
}

function formatCompositeWithEstimation(value: object, availableLen: number, depth: number, maxDepthForFirst5: number): string {
    const isArray = Array.isArray(value);
    const className = isArray ? undefined : getClassName(value);

    const openBracket = isArray ? '[ ' : (className ? className + '(' : '{ ');
    const closeBracket = isArray ? ' ]' : (className ? ')' : ' }');

    // Reserve space for brackets
    const bracketOverhead = openBracket.length + closeBracket.length;
    if (availableLen <= bracketOverhead) {
        return openBracket + '...' + closeBracket;
    }

    const contentBudget = availableLen - bracketOverhead;

    const entries = isArray
        ? (value as unknown[]).map((val, index) => [index, val])
        : Object.entries(value);

    if (entries.length === 0) {
        return openBracket + closeBracket;
    }

    // Estimate how much space each entry needs
    const estimatedSizes: number[] = [];
    let totalEstimated = 0;

    for (const [key, val] of entries) {
        const keyPart = isArray ? '' : `${key}: `;
        const minValueSize = getMinimumValueSize(val);
        const entrySize = keyPart.length + minValueSize;
        estimatedSizes.push(entrySize);
        totalEstimated += entrySize;
    }

    // Add separator overhead (", " between entries)
    const separatorOverhead = Math.max(0, (entries.length - 1) * 2);
    totalEstimated += separatorOverhead;

    // Distribute remaining budget
    const extraBudget = Math.max(0, contentBudget - totalEstimated);

    let result = openBracket;
    let usedBudget = 0;

    for (let i = 0; i < entries.length; i++) {
        const [key, val] = entries[i];

        if (i > 0) {
            if (usedBudget + 2 > contentBudget) {
                result += '...';
                break;
            }
            result += ', ';
            usedBudget += 2;
        }

        const keyPart = isArray ? '' : `${key}: `;
        if (usedBudget + keyPart.length > contentBudget) {
            result += '...';
            break;
        }

        result += keyPart;
        usedBudget += keyPart.length;

        // Calculate budget for this value
        const baseValueBudget = estimatedSizes[i] - keyPart.length;
        const extraForThisEntry = i < 5 ? Math.floor(extraBudget / Math.min(5, entries.length)) : 0;
        const valueBudget = baseValueBudget + extraForThisEntry;
        const availableForValue = Math.min(valueBudget, contentBudget - usedBudget);

        if (availableForValue <= 0) {
            result += '...';
            break;
        }

        const shouldAllowDeepExpansion = depth < maxDepthForFirst5 && i < 5;
        const formattedValue = formatValueWithDepthControl(val, availableForValue, shouldAllowDeepExpansion ? depth + 1 : depth, maxDepthForFirst5);

        result += formattedValue;
        usedBudget += formattedValue.length;

        if (usedBudget >= contentBudget) {
            break;
        }
    }

    result += closeBracket;
    return result;
}

function getMinimumValueSize(value: unknown): number {
    switch (typeof value) {
        case 'number':
            return ('' + value).length;
        case 'string':
            return Math.min(value.length + 2, 10); // "..." minimum
        case 'boolean':
            return value ? 4 : 5; // true/false
        case 'undefined':
            return 9; // undefined
        case 'object':
            if (value === null) return 4; // null
            return 8; // minimum for {...} or [...]
        case 'symbol':
            return 12; // rough estimate
        case 'function':
            return 12; // [[Function]]
        default:
            return 8;
    }
}

function formatValueWithDepthControl(value: unknown, availableLen: number, depth: number, maxDepthForFirst5: number): string {
    switch (typeof value) {
        case 'number':
            return '' + value;
        case 'string':
            if (value.length + 2 <= availableLen) {
                return `"${value}"`;
            }
            return `"${value.substr(0, availableLen - 7)}"+...`;
        case 'boolean':
            return value ? 'true' : 'false';
        case 'undefined':
            return 'undefined';
        case 'object':
            if (value === null) {
                return 'null';
            }
            // Control depth expansion
            if (depth >= maxDepthForFirst5) {
                return Array.isArray(value) ? '[...]' : '{...}';
            }
            return formatCompositeWithEstimation(value, availableLen, depth, maxDepthForFirst5);
        case 'symbol':
            return value.toString();
        case 'function':
            return `[[Function${value.name ? ' ' + value.name : ''}]]`;
        default:
            return '' + value;
    }
}

function formatCompositeOld(value: object, availableLen: number): string {
    // Handle objects with custom toString methods
    if (!Array.isArray(value) && typeof value.toString === 'function' && value.toString !== Object.prototype.toString) {
        const val = value.toString();
        if (val.length <= availableLen) {
            return val;
        }
        return val.substring(0, availableLen - 3) + '...';
    }

    const isArray = Array.isArray(value);
    const className = isArray ? undefined : getClassName(value);

    const openBracket = isArray ? '[ ' : (className ? className + '(' : '{ ');
    const closeBracket = isArray ? ' ]' : (className ? ')' : ' }');

    let result = openBracket;
    let first = true;

    const entries = isArray
        ? (value as unknown[]).map((val, index) => [index, val])
        : Object.entries(value);

    for (const [key, val] of entries) {
        if (!first) {
            result += ', ';
        }
        if (result.length - 5 > availableLen) {
            result += '...';
            break;
        }
        first = false;
        if (!isArray) {
            result += `${key}: `;
        }
        result += formatValue(val, availableLen - result.length);
    }

    result += closeBracket;
    return result;
}

function getClassName(obj: object): string | undefined {
    const ctor = obj.constructor;
    if (ctor) {
        if (ctor.name === 'Object') {
            return undefined;
        }
        return ctor.name;
    }
    return undefined;
}
