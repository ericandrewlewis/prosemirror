import {ProseMirror} from "../dist/edit/main"
import "../dist/inputrules/autoinput"
import "../dist/menu/tooltipmenu"
import "../dist/menu/menubar"
import {schema} from "./customschema"

var pm = window.pm = new ProseMirror({
  place: document.querySelector(".full"),
  autoInput: true,
  tooltipMenu: {selectedBlockMenu: true},
  menuBar: {float: true},
  doc: document.querySelector("#content"),
  docFormat: "dom",
  schema: schema
})

document.querySelector("#mark").addEventListener("mousedown", function(e) {
  pm.markRange(pm.selection.from, pm.selection.to, {className: "marked"})
  e.preventDefault()
})

setTimeout( function() {
  pm.tr.replaceSelection(pm.schema.node("image_from_an_api")).apply()
  pm.tr.replaceSelection(pm.schema.node("image_from_an_api")).apply()
}, 1000 );
