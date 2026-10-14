const tableSortStates = new WeakMap();
const tableSortCollator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: "base"
});

// Resolves a cell to a comparable sort value for the column's sort type.
function tableSortValue(cell, sortType) {
    if (!cell) {
        return "";
    }
    if (cell.dataset.sortValue !== undefined) {
        return sortType === "number"
            ? Number(cell.dataset.sortValue)
            : sortType === "date"
                ? new Date(cell.dataset.sortValue).getTime()
                : cell.dataset.sortValue;
    }
    if (sortType === "number") {
        const value = Number(cell.textContent.replace(/[^\d.-]/g, ""));
        return Number.isNaN(value) ? Number.NEGATIVE_INFINITY : value;
    }
    if (sortType === "date") {
        const value = Date.parse(cell.textContent);
        return Number.isNaN(value) ? Number.NEGATIVE_INFINITY : value;
    }
    return cell.textContent.trim();
}

// Reorders a table's body rows to match its current sort state.
function applyTableSort(table) {
    const state = tableSortStates.get(table);
    if (!state || state.key === null) {
        return;
    }
    const body = table.tBodies[0];
    if (!body) {
        return;
    }

    const rows = Array.from(body.rows);
    const sortableRows = rows
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => !Array.from(row.cells).some((cell) => cell.colSpan > 1));
    const type = state.header.dataset.sortType || "text";
    sortableRows.sort((left, right) => {
        const leftValue = tableSortValue(left.row.cells[state.key], type);
        const rightValue = tableSortValue(right.row.cells[state.key], type);
        let comparison;
        if (type === "number" || type === "date") {
            comparison = leftValue - rightValue;
        } else {
            comparison = tableSortCollator.compare(String(leftValue), String(rightValue));
        }
        return Number.isNaN(comparison) || comparison === 0
            ? left.index - right.index
            : comparison * state.direction;
    });
    for (const { row } of sortableRows) {
        body.append(row);
    }
}

// Adds click-to-sort header buttons to a table and keeps its sort state.
function makeTableSortable(table) {
    if (!table) {
        return;
    }
    const headerRow = table.tHead?.rows[0];
    if (!headerRow) {
        return;
    }
    const signature = Array.from(headerRow.cells, (cell) =>
        cell.querySelector(".table-sort-button span:first-child")?.textContent.trim() ||
        cell.textContent.trim()
    ).join("|");
    let state = tableSortStates.get(table);
    if (!state || state.signature !== signature) {
        state = { signature, key: null, direction: 1, header: null };
        tableSortStates.set(table, state);
    }

    Array.from(headerRow.cells).forEach((header, index) => {
        if (header.hidden || header.dataset.sortable === "false" ||
            !header.textContent.trim()) {
            header.removeAttribute("aria-sort");
            return;
        }
        let button = header.querySelector(".table-sort-button");
        if (!button) {
            const label = header.textContent.trim();
            header.replaceChildren();
            button = document.createElement("button");
            button.type = "button";
            button.className = "table-sort-button";
            button.setAttribute("aria-label", `Sort by ${label}`);
            const text = document.createElement("span");
            text.textContent = label;
            const indicator = document.createElement("span");
            indicator.className = "table-sort-indicator";
            indicator.setAttribute("aria-hidden", "true");
            button.append(text, indicator);
            header.append(button);
        }
        button.onclick = () => {
            if (state.key === index) {
                state.direction *= -1;
            } else {
                state.key = index;
                state.direction = 1;
            }
            state.header = header;
            for (const cell of headerRow.cells) {
                cell.removeAttribute("aria-sort");
                const indicator = cell.querySelector(".table-sort-indicator");
                if (indicator) {
                    indicator.textContent = "";
                }
            }
            header.setAttribute("aria-sort", state.direction === 1 ? "ascending" : "descending");
            button.querySelector(".table-sort-indicator").textContent =
                state.direction === 1 ? " ▲" : " ▼";
            applyTableSort(table);
        };
    });

    if (state.key !== null && headerRow.cells[state.key]) {
        state.header = headerRow.cells[state.key];
        state.header.setAttribute("aria-sort", state.direction === 1 ? "ascending" : "descending");
        const indicator = state.header.querySelector(".table-sort-indicator");
        if (indicator) {
            indicator.textContent = state.direction === 1 ? " ▲" : " ▼";
        }
        applyTableSort(table);
    }
}

window.makeTableSortable = makeTableSortable;