import {ProseMirror} from "../dist/edit/main"
import "../dist/inputrules/autoinput"
import "../dist/menu/tooltipmenu"
import "../dist/menu/menubar"
import {LockedBlock} from "./lockedblock"

var pm = window.pm = new ProseMirror({
  place: document.querySelector(".full"),
  autoInput: true,
  tooltipMenu: {selectedBlockMenu: true},
  menuBar: {float: true},
  doc: document.querySelector("#content"),
  docFormat: "dom"
})

document.querySelector("#mark").addEventListener("mousedown", function(e) {
  pm.markRange(pm.selection.from, pm.selection.to, {className: "marked"})
  e.preventDefault()
})
