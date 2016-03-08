import { Block, Attribute } from "../../dist/model"
// import { fromHTMLLeaf } from "../../transforms/from_html"

export class ImageFromAnAPI extends Block {
	get attrs() {
		return {
			position: new Attribute({default: "medium-center"})
		}
	}

	get draggable() { return true }

	get contains() { return null }

	serializeDOM(node, s) {
		let ele = document.createElement("div")
		let img = document.createElement("img")
		img.src = "http://prosemirror.net/img/logo.png"
		ele.appendChild(img)
		return ele
	}

	deserializeDOMAttrs(dom) {
		debugger
		let attrs = {}
		dom.classList.forEach((c) => {
			if(c.indexOf("position-") === 0)
				attrs["position"] = c.replace("position-", "")
		})
		return attrs
	}

}

// This isn't gonna work because fromHTMLLeaf is custom shit.
// ImageFromAnAPI.register('parseDOM', 'div', {
// 	selector: '[data-type="image-from-an-api"]',
// 	parse: fromHTMLLeaf,
// 	rank: 40
// })
