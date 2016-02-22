import {Pos} from "../model"
import {Transform, Step, Remapping} from "../transform"

// Steps are stored in inverted form (so that they can be applied to
// undo the original).
class InvertedStep {
  constructor(step, version, id) {
    this.step = step
    this.version = version
    this.id = id
  }
}

class BranchRemapping {
  constructor(branch) {
    this.branch = branch
    this.remap = new Remapping
    this.version = branch.version
    this.mirrorBuffer = Object.create(null)
  }

  moveToVersion(version) {
    while (this.version > version) this.addNextMap()
  }

  addNextMap() {
    let found = this.branch.mirror[this.version]
    let mapOffset = this.branch.maps.length - (this.branch.version - this.version) - 1
    let id = this.remap.addToFront(this.branch.maps[mapOffset], this.mirrorBuffer[this.version])
    --this.version
    if (found != null) this.mirrorBuffer[found] = id
    return id
  }

  movePastStep(result) {
    let id = this.addNextMap()
    if (result) this.remap.addToBack(result.map, id)
  }
}

const workTime = 100, pauseTime = 150

class CompressionWorker {
  constructor(doc, branch, callback) {
    this.branch = branch
    this.callback = callback
    this.remap = new BranchRemapping(branch)

    this.doc = doc
    this.events = []
    this.maps = []
    this.version = this.startVersion = branch.version

    this.i = branch.events.length
    this.timeout = null
    this.aborted = false
  }

  work() {
    if (this.aborted) return

    let endTime = Date.now() + workTime

    for (;;) {
      if (this.i == 0) return this.finish()
      let event = this.branch.events[--this.i], outEvent = []
      for (let j = event.length - 1; j >= 0; j--) {
        let {step, version: stepVersion, id: stepID} = event[j]
        this.remap.moveToVersion(stepVersion)

        let mappedStep = step.map(this.remap.remap)
        if (mappedStep && isDelStep(step)) {
          let extra = 0, start = step.from
          while (j > 0) {
            let next = event[j - 1]
            if (next.version != stepVersion - 1 || !isDelStep(next.step) ||
                start.cmp(next.step.to))
              break
            extra += next.step.to.offset - next.step.from.offset
            start = next.step.from
            stepVersion--
            j--
            this.remap.addNextMap()
          }
          if (extra > 0) {
            let start = mappedStep.from.move(-extra)
            mappedStep = new Step("replace", start, mappedStep.to, start)
          }
        }
        let result = mappedStep && mappedStep.apply(this.doc)
        if (result) {
          this.doc = result.doc
          this.maps.push(result.map.invert())
          outEvent.push(new InvertedStep(mappedStep, this.version, stepID))
          this.version--
        }
        this.remap.movePastStep(result)
      }
      if (outEvent.length) {
        outEvent.reverse()
        this.events.push(outEvent)
      }
      if (Date.now() > endTime) {
        this.timeout = window.setTimeout(() => this.work(), pauseTime)
        return
      }
    }
  }

  finish() {
    if (this.aborted) return

    this.events.reverse()
    this.maps.reverse()
    this.callback(this.maps.concat(this.branch.maps.slice(this.branch.maps.length - (this.branch.version - this.startVersion))),
                  this.events)
  }

  abort() {
    this.aborted = true
    window.clearTimeout(this.timeout)
  }
}

function isDelStep(step) {
  return step.type == "replace" && step.from.offset < step.to.offset &&
    Pos.samePath(step.from.path, step.to.path) && (!step.param || step.param.content.size == 0)
}

const compressStepCount = 150

// A branch is a history of steps. There'll be one for the undo and
// one for the redo history.
class Branch {
  constructor(maxDepth) {
    this.maxDepth = maxDepth
    this.version = 0
    this.nextStepID = 1

    this.maps = []
    this.mirror = Object.create(null)
    this.events = []

    this.stepsSinceCompress = 0
    this.compressing = null
    this.compressTimeout = null
  }

  clear(force) {
    if (force || !this.empty()) {
      this.maps.length = this.events.length = this.stepsSinceCompress = 0
      this.mirror = Object.create(null)
      this.abortCompression()
    }
  }

  newEvent() {
    this.abortCompression()
    this.events.push([])
    while (this.events.length > this.maxDepth)
      this.events.shift()
  }

  addMap(map) {
    if (!this.empty()) {
      this.maps.push(map)
      this.version++
      this.stepsSinceCompress++
      return true
    }
  }

  empty() {
    return this.events.length == 0
  }

  addStep(step, map, id) {
    this.addMap(map)
    if (id == null) id = this.nextStepID++
    this.events[this.events.length - 1].push(new InvertedStep(step, this.version, id))
  }

  // : (Transform, ?[number])
  // Add a transform to the branch's history.
  addTransform(transform, ids) {
    this.abortCompression()
    for (let i = 0; i < transform.steps.length; i++) {
      let inverted = transform.steps[i].invert(transform.docs[i], transform.maps[i])
      this.addStep(inverted, transform.maps[i], ids && ids[i])
    }
  }

  // : (Node, bool) → {transform: Transform, ids: [number]}
  // Pop the latest event off the branch's history and apply it
  // to a document transform, returning the transform and the step ID.
  popEvent(doc, allowCollapsing) {
    this.abortCompression()
    let event = this.events.pop()
    if (!event) return null

    let remap = new BranchRemapping(this), collapsing = allowCollapsing
    let tr = new Transform(doc)
    let ids = []

    for (let i = event.length - 1; i >= 0; i--) {
      let invertedStep = event[i], step = invertedStep.step
      if (!collapsing || invertedStep.version != remap.version) {
        collapsing = false
        remap.moveToVersion(invertedStep.version)

        step = step.map(remap.remap)
        let result = step && tr.step(step)
        if (result) {
          ids.push(invertedStep.id)
          if (this.addMap(result.map))
            this.mirror[this.version] = invertedStep.version
        }

        if (i > 0) remap.movePastStep(result)
      } else {
        this.version--
        delete this.mirror[this.version]
        this.maps.pop()
        tr.step(step)
        ids.push(invertedStep.id)
        --remap.version
      }
    }
    if (this.empty()) this.clear(true)
    return {transform: tr, ids}
  }

  lastStep() {
    for (let i = this.events.length - 1; i >= 0; i--) {
      let event = this.events[i]
      if (event.length) return event[event.length - 1]
    }
  }

  getVersion() {
    let step = this.lastStep()
    return {lastID: step && step.id, version: this.version}
  }

  isAtVersion(version) {
    let step = this.lastStep()
    return this.version == version.version && (step && step.id) == version.lastID
  }

  findVersion(version) {
    for (let i = this.events.length - 1; i >= 0; i--) {
      let event = this.events[i]
      for (let j = event.length - 1; j >= 0; j--)
        if (event[j].id <= version.lastID)
          return {event: i, step: j + 1}
    }
  }

  rebased(newMaps, rebasedTransform, positions) {
    if (this.empty()) return
    this.abortCompression()

    let startVersion = this.version - positions.length

    // Update and clean up the events
    out: for (let i = this.events.length - 1; i >= 0; i--) {
      let event = this.events[i]
      for (let j = event.length - 1; j >= 0; j--) {
        let step = event[j]
        if (step.version <= startVersion) break out
        let off = positions[step.version - startVersion - 1]
        if (off == -1) {
          event.splice(j--, 1)
        } else {
          let inv = rebasedTransform.steps[off].invert(rebasedTransform.docs[off],
                                                       rebasedTransform.maps[off])
          event[j] = new InvertedStep(inv, startVersion + newMaps.length + off + 1, step.id)
        }
      }
    }

    // Sync the array of maps
    if (this.maps.length > positions.length)
      this.maps = this.maps.slice(0, this.maps.length - positions.length).concat(newMaps).concat(rebasedTransform.maps)
    else
      this.maps = rebasedTransform.maps.slice()

    this.version = startVersion + newMaps.length + rebasedTransform.maps.length

    this.stepsSinceCompress += newMaps.length + rebasedTransform.steps.length - positions.length
  }

  abortCompression() {
    if (this.compressing) {
      this.compressing.abort()
      this.compressing = null
    }
  }

  needsCompression() {
    return this.stepsSinceCompress > compressStepCount && !this.compressing
  }

  startCompression(doc) {
    this.compressing = new CompressionWorker(doc, this, (maps, events) => {
      this.maps = maps
      this.events = events
      this.mirror = Object.create(null)
      this.compressing = null
      this.stepsSinceCompress = 0
    })
    this.compressing.work()
  }
}

const compressDelay = 750

// ;; An undo/redo history manager for an editor instance.
export class History {
  constructor(pm) {
    this.pm = pm

    this.done = new Branch(pm.options.historyDepth)
    this.undone = new Branch(pm.options.historyDepth)

    this.lastAddedAt = 0
    this.ignoreTransform = false

    this.allowCollapsing = true

    pm.on("transform", (transform, options) => this.recordTransform(transform, options))
  }

  // : (Transform, Object)
  // Record a transformation in undo history.
  recordTransform(transform, options) {
    if (this.ignoreTransform) return

    if (options.addToHistory == false) {
      for (let i = 0; i < transform.maps.length; i++) {
        let map = transform.maps[i]
        this.done.addMap(map)
        this.undone.addMap(map)
      }
    } else {
      this.undone.clear()
      let now = Date.now()
      // Group transforms that occur in quick succession into one event.
      if (now > this.lastAddedAt + this.pm.options.historyEventDelay) {
        this.done.newEvent()

      this.done.addTransform(transform)
      this.lastAddedAt = now
    }
    this.maybeScheduleCompression()
  }

  // :: () → bool
  // Undo one history event. The return value indicates whether
  // anything was actually undone. Note that in a collaborative
  // context, or when changes are [applied](#ProseMirror.apply)
  // without adding them to the history, it is possible for
  // [`undoDepth`](#History.undoDepth) to have a positive value, but
  // this method to still return `false`, when non-history changes
  // overwrote all remaining changes in the history.
  undo() { return this.shift(this.done, this.undone) }

  // :: () → bool
  // Redo one history event. The return value indicates whether
  // anything was actually redone.
  redo() { return this.shift(this.undone, this.done) }

  // :: number
  // The amount of undoable events available.
  get undoDepth() { return this.done.events.length }

  // :: number
  // The amount of redoable events available.
  get redoDepth() { return this.undone.events.length }

  // : (Branch, Branch) → bool
  // Apply the latest event from one branch to the document and shift
  // the event onto the other branch. Returns true when an event could
  // be shifted.
  shift(from, to) {
    let event = from.popEvent(this.pm.doc, this.allowCollapsing)
    if (!event) return false
    let {transform, ids} = event

    this.ignoreTransform = true
    this.pm.apply(transform)
    this.ignoreTransform = false

    if (!transform.steps.length) return this.shift(from, to)

    if (to) {
      to.newEvent()
      to.addTransform(transform, ids)
    }
    this.lastAddedAt = 0

    return true
  }

  // :: () → Object
  // Get the current ‘version’ of the editor content. This can be used
  // to later [check](#History.isAtVersion) whether anything changed, or
  // to [roll back](#History.backToVersion) to this version.
  getVersion() { return this.done.getVersion() }

  // :: (Object) → bool
  // Returns `true` when the editor history is in the state that it
  // was when the given [version](#History.getVersion) was recorded.
  // That means either no changes were made, or changes were
  // done/undone and then undone/redone again.
  isAtVersion(version) { return this.done.isAtVersion(version) }

  // :: (Object) → bool
  // Rolls back all changes made since the given
  // [version](#History.getVersion) was recorded. Returns `false` if
  // that version was no longer found in the history, and thus the
  // action could not be completed.
  backToVersion(version) {
    let found = this.done.findVersion(version)
    if (!found) return false
    let event = this.done.events[found.event]
    if (found.event == this.done.events.length - 1 && found.step == event.length) return true
    let combined = this.done.events.slice(found.event + 1)
        .reduce((comb, arr) => comb.concat(arr), event.slice(found.step))
    this.done.events.length = found.event + ((event.length = found.step) ? 1 : 0)
    this.done.events.push(combined)

    this.shift(this.done)
    return true
  }

  rebased(newMaps, rebasedTransform, positions) {
    this.done.rebased(newMaps, rebasedTransform, positions)
    this.undone.rebased(newMaps, rebasedTransform, positions)
    this.maybeScheduleCompression()
  }

  maybeScheduleCompression() {
    this.maybeScheduleCompressionForBranch(this.done)
    this.maybeScheduleCompressionForBranch(this.undone)
  }

  maybeScheduleCompressionForBranch(branch) {
    window.clearTimeout(branch.compressTimeout)
    if (branch.needsCompression())
      branch.compressTimeout = window.setTimeout(() => {
        if (branch.needsCompression())
          branch.startCompression(this.pm.doc)
      }, compressDelay)
  }
}
