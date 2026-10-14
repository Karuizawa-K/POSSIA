(function () {
  // Appends a text cell to a table row.
  function addCell(row, value) {
    const cell = document.createElement("td");
    cell.textContent = value == null ? "" : String(value);
    row.append(cell);
    return cell;
  }

  // Writes a page status line, optionally styled as an error.
  function setStatusMessage(element, message, isError = false) {
    element.textContent = message;
    element.classList.toggle("error-message", isError);
  }

  window.addCell = addCell;
  window.setStatusMessage = setStatusMessage;
})();