// rotodrag.js
// A JavaScript library for svg object translation and rotoation
// using mouse or touch events.
// Copyright (c) 2018, University of Southern California
// BSD-2-Clause License

'use strict';

const Rotodrag = (svg) => {

    // PRIVATE VARIABLES

    // Array of draggable svg elements
    const draggables = svg.querySelectorAll('.draggable');
    const recordables = svg.querySelectorAll('.recordable');

    // Log initialization & draggable centers
    console.group('Rotodrag initialized');
    console.log(`${draggables.length} draggable object(s) found.`);
    draggables.forEach((el, i) => {
        const bb = el.getBBox();
        const cx = bb.x + (bb.width * 0.5);
        const cy = bb.y + (bb.height * 0.5);
        console.log(`  ${i}: id="${el.id || 'unnamed'}" with center (${cx.toFixed(1)}, ${cy.toFixed(1)})`);
    });
    console.groupEnd();

    // Arrays store dragging data, indexed by position in draggables array;
    let offsets = []; // points encoding distance to center point
    let offsetAngles = []; // angles from offset to center point

    // What mode are we in?
    let inDragMode = false; // default is no dragging
    let recordEnabled = false; // default is no recording
    let recordMode = 'pause'; // 'pause', 'play', 'record', or 'overdub'

    // Special variables needed for svg-level event handlers (mousemove)
    let mouseDragging = false; // True when mousedown on a draggable object
    let mouseTarget = null; // The object that is being dragged with a mouse

    // Recording and playback
    let player; // timer for playback
    const playbackInterval = 10; // milliseconds
    let playbackTimepoint; // where are we now?
    let pauseTimepoint = 0; // when did we pause?
    let positionData = {};
    let recordStartTime;
    let recordEndTime = 0; // highest timepoint in positionData;

    // Special recording modes
    let enableRecordingFromPause = false;
    let enableRecordingFromPlaybackEnd = false;
    let enableRecordingDuringPlayback = false;

    // Recording timeout function
    let timeoutID = null;
    let timeoutFunction = null;
    let timeoutMilliseconds = 0;

    // UTILITY FUNCTIONS

    const getIndex = (obj) => {
        // returns index of object in draggables array
        for (let i = 0; i < draggables.length; i++) {
            if (draggables[i] === obj) {
                return i;
            }
        }
        return -1;
    }

    const getIndexByCharacterName = (name) => {
        for (let i = 0; i < draggables.length; i++) {
            if (draggables[i].getAttribute("data-character-name") == name) {
                return i;
            }
        }
        return -1;
    }

    const isRecordable = (obj) => {
        for (let i = 0; i < recordables.length; i++) {
            if (recordables[i] === obj) {
                return true;
            }
        }
        return false;
    }

    const getCenter = (shape) => {
        // return the center point of the given shape
        // assuming that its center is 0,0 with no transforms
        const pt = svg.createSVGPoint();
        return pt.matrixTransform(svg.getTransformToElement(shape).inverse());
    }

    const getRelativePoint = (p1, p2) => {
        // calculate p1 as a point relative to point p2, then return drag point
        let pt = svg.createSVGPoint();
        pt.x = p1.x - p2.x;
        pt.y = p1.y - p2.y;
        return (pt);
    }

    const getSVGPoint = (e) => {
        const pt = svg.createSVGPoint();
        pt.x = e.clientX;
        pt.y = e.clientY;
        return pt.matrixTransform(svg.getScreenCTM().inverse());
    }

    // DRAGGING FUNCTIONS

    // startDrag : initialize relevant dragging variables
    const startDrag = (obj, svgPoint) => {
        const i = getIndex(obj); // unique identifier
        // calculate the dragging start point relative to the object's
        // center point (and regardless of the shape's current rotation)
        offsets[i] = svgPoint.matrixTransform(svg.getTransformToElement(obj));
        // calculate the angle between the dragging start point and the shape's center point
        const o = Math.atan2(offsets[i].y, offsets[i].x) * 180 / Math.PI + 90;
        if (o < 0) {
            // if the angle is less than 0, add a full rotation for human readability
            offsetAngles[i] = o + 360;
        }
        else {
            offsetAngles[i] = o;
        }
        // fire event
        const evt = new CustomEvent('draggableStartDrag', { bubbles: false, cancelable: false, detail: null });
        svg.dispatchEvent(evt);
    }

    // drag : calculate relative changes
    const drag = (obj, dragEnd) => {
        const i = getIndex(obj); // unique identifier
        // get the center point of the current position of the shape
        const center = getCenter(obj);
        // get the coordinates of the new dragging point relative to the current center point
        const relativeDragEnd = getRelativePoint(dragEnd, center);
        // calculate the angle between the new dragging point and the center point
        let relativeAngle = Math.atan2(relativeDragEnd.y, relativeDragEnd.x) * 180 / Math.PI + 90;
        if (relativeAngle < 0) {
            relativeAngle = relativeAngle + 360;
        } // for human clarity
        // adjust the angle of rotation by subtracting the angle between the dragging start point and the center point
        const rotation = relativeAngle - offsetAngles[i];
        //call moveTo() to move the shape based on the above calculations
        moveTo(obj, dragEnd, rotation, offsets[i]);
    }

    // moveTo : update the transform attribute, handle special cases
    const moveTo = (shape, dragEnd, rotation, offset) => {
        // translate and rotate the given shape according to the given values
        if (rotation < 0) { rotation = rotation + 360; } // human clarity
        let transformString;
        const slipRadius = Number(shape.getAttribute('data-slip-radius')) || 100;
        if (shape.getAttribute('data-dragstyle') === 'rotate') {
            const above = Number(shape.getAttribute('data-rotate-above')) || 0;
            const below = Number(shape.getAttribute('data-rotate-below')) || 360;
            const posx = Number(shape.getAttribute('data-fixed-x'));
            const posy = Number(shape.getAttribute('data-fixed-y'));
            if ((rotation < above) && (rotation > below)) {
                transformString = shape.getAttribute('transform'); // don't move
            }
            else {
                transformString = `translate(${posx}, ${posy}) rotate(${rotation}) `;
            }
        }
        else if ((shape.getAttribute('data-dragstyle') === 'slippery') &&
            (Math.sqrt(Math.pow(offset.x, 2) + Math.pow(offset.y, 2)) < slipRadius)) {
            transformString = shape.getAttribute('transform'); // don't move
            slipTo(shape, dragEnd);
        }
        else if (shape.getAttribute('data-dragstyle') === 'xaxis') {
            const posy = Number(shape.getAttribute('data-fixed-y'));
            const posx = dragEnd.x + (offset.x * -1);
            const minx = Number(shape.getAttribute('data-min-x'));
            const maxx = Number(shape.getAttribute('data-max-x'));
            if (posx < minx) { posx = minx; }
            if (posx > maxx) { posx = maxx; }
            transformString = `translate(${posx}, ${posy}) `;
        }
        else {
            transformString = `translate(${dragEnd.x}, ${dragEnd.y}) rotate(${rotation}) translate(${-offset.x}, ${-offset.y})`;
        }

        shape.setAttributeNS(null, "transform", transformString);
        shape.transform.baseVal.consolidate();
        if ((recordMode === 'record') && isRecordable(shape)) {
            continueRecording();
        }
    }

    // slipTo : handle sippery centers, update relevant dragging variables
    const slipTo = (shape, point) => {
        // Could be fancier, but this works:
        startDrag(shape, point);

    }

    // RECORDING FUNCTIONS

    const startRecording = (offset = 0) => {
        // initialize recording by getting the current timestamp,
        recordStartTime = new Date().getTime() - offset;
        // setting the recording boolean to true to indicate recording is taking place,
        //inRecordMode = true;
        recordMode = 'record';
        // kicking off any timeout function that has been set
        if (timeoutFunction != null) {
            timeoutID = window.setTimeout(timeoutFunction, timeoutMilliseconds);
        }
        // and calling continueRecording() to record the next timepoint
        if (offset === 0) {
            continueRecording();
        }
    }

    const startRecordingFromPause = () => {
        clearRecordingFrom(pauseTimepoint);
        startRecording(pauseTimepoint);
    }

    const continueRecording = () => {
        //get the recording timepoint by determining how much time has elapsed since recording began,
        let recordTimepoint = new Date().getTime() - recordStartTime;
        // then call record() to save the position data for this timepoint
        record(recordTimepoint);
    }

    const stopRecording = () => {
        // end recording by setting the recording boolean to false
        //inRecordMode = false;
        recordMode = 'pause';
        if (timeoutFunction != null) {
            window.clearTimeout(timeoutID);
        }
    }

    const pauseRecording = () => {
        // what time is it?
        pauseTimepoint = elapsedTime();
        // pause recording by setting the recording boolean to false, but leave any timer running
        //inRecordMode = false;
        recordMode = 'pause';
        // maybe make a more sophistocated timer sometime in the future?
    }

    const clearRecording = () => {
        pausePlayback();
        seekTo(0); // move objects back to start
        positionData = {}; // clear position data
        record(0); // set zero point
    }

    const clearRecordingFrom = (killPoint) => {
        // erase all position data beyond a given timepoint, in milliseconds
        let biggest = 0;
        for (const prop of Object.keys(positionData)) {
            const timepoint = parseInt(prop);
            if (timepoint >= killPoint) {
                delete positionData[prop];
            }
            else if (timepoint > biggest) {
                biggest = timepoint;
            }
        }
        recordEndTime = biggest;
    }

    const record = (timePoint) => {
        //record the position of all shapes at the given timepoint in the positionData object
        positionData[timePoint] = {};
        let name, transform;
        for (let i = 0; i < recordables.length; i++) {
            name = recordables[i].getAttribute("data-character-name");
            transform = recordables[i].getAttribute("transform");
            positionData[timePoint][name] = transform;
        }
        if (timePoint > recordEndTime) {
            recordEndTime = timePoint;
        }
    }

    record(0); // initialize position data

    const getTrimmedPositionData = (start, end) => {
        let oriT; // original timepoint
        let adjT;  //adjusted timepoint
        let result = {}; // new position data object

        // start with the 0 position
        let oneBefore = getClosestTimepoint(getSortedTimepoints(), start, 0); // positioning before start
        result['0'] = positionData[oneBefore];

        // then fill in the rest
        for (const prop of Object.keys(positionData)) {
            oriT = parseInt(prop);
            if ((oriT >= start) && (oriT <= end)) { // within range
                adjT = oriT - start;
                result[adjT] = positionData[oriT];
            }
        }
        return result;
    }



    // PLAYBACK FUNCTIONS

    const startPlayback = (offset = 0) => {
        // initialize playback by ending the current playback (if needed)
        stopPlayback(); //end previous playback before starting new
        const playbackStartTime = new Date().getTime();
        // and then setting up a player that will retrieve position data every 10 milliseconds
        // and display the position at that timepoint
        const sortedTimepoints = getSortedTimepoints();
        player = setInterval(() => {
            if (recordMode === 'play') { // insurance, because sometimes timers persist, maybe?
                playbackTimepoint = new Date().getTime() - playbackStartTime + offset;
                const playbackTimepointProperty = getClosestTimepoint(sortedTimepoints, playbackTimepoint, 0);
                playback(playbackTimepointProperty);
                // end of show?
                if (playbackTimepoint > sortedTimepoints[sortedTimepoints.length - 1]) {
                    pausePlayback();
                    playback(recordEndTime); // show the last recorded frame
                    if (enableRecordingFromPlaybackEnd) {
                        startRecordingFromPause();
                        //inDragMode = true;
                        //inRecordMode = true;
                    }
                }
            }
        }, playbackInterval);
        recordMode = 'play';
    }

    const startPlaybackFromPause = () => {
        startPlayback(pauseTimepoint);
    }

    const playback = (timePoint) => {
        for (const [name, transform] of Object.entries(positionData[timePoint])) {
            const element = draggables[getIndexByCharacterName(name)];
            element.setAttributeNS(null, "transform", transform);
        }
    }

    const stopPlayback = () => { //end playback by clearing the player
        clearInterval(player);
        recordMode = 'pause';
    }

    const pausePlayback = () => { //end playback by clearing the player
        // what time is it?
        pauseTimepoint = elapsedTime();
        clearInterval(player);
        recordMode = 'pause';
    }

    const seekTo = (milliseconds) => { // should only be used when in pause mode
        if (recordMode === 'pause') {
            const sortedTimepoints = getSortedTimepoints();
            const playbackTimepointProperty = getClosestTimepoint(sortedTimepoints, milliseconds, 0);
            playback(playbackTimepointProperty);
            pauseTimepoint = milliseconds;
        }
    }

    const getSortedTimepoints = () => 
        Object.keys(positionData).map(Number).sort((a, b) => a - b);

    const getClosestTimepoint = (sortedTimepoints, targetTimepoint, startIndex) => {
        if (targetTimepoint > recordEndTime) { return recordEndTime; }
        // use binary search to return the timepoint in positionData that occurs
        // directly before the given targetTimepoint
        const stopIndex = sortedTimepoints.length - 1;
        const middle = Math.floor((stopIndex + startIndex) / 2);
        if (targetTimepoint >= sortedTimepoints[stopIndex]) {
            return stopIndex;
        }
        const targetRangeMin = sortedTimepoints[middle];
        const targetRangeMax = sortedTimepoints[middle + 1];

        while ((targetTimepoint < targetRangeMin || targetTimepoint >= targetRangeMax) && startIndex < stopIndex) {
            //adjust search area
            if (targetTimepoint < sortedTimepoints[middle]) {
                stopIndex = middle - 1;
            } else if (targetTimepoint >= sortedTimepoints[middle + 1]) {
                startIndex = middle + 1;
            }
            //recalculate middle
            middle = Math.floor((stopIndex + startIndex) / 2);
            targetRangeMin = sortedTimepoints[middle];
            targetRangeMax = sortedTimepoints[middle + 1];
        }
        return sortedTimepoints[middle];
    }

    const getLastTimepoint = () => {
        const sorted = getSortedTimepoints();
        const index = sorted.length - 1;
        return sorted[index];
    }

    const elapsedTime = () => {
        // dependent on recordMode
        if (recordMode === 'record') {
            return (new Date().getTime() - recordStartTime);
        }
        if (recordMode === 'play') {
            return playbackTimepoint;
        }
        if (recordMode === 'pause') {
            return pauseTimepoint;
        }
        if (recordMode === 'overdub') {
            // ??
            return 0;
        }
    }


    // EVENT HANDLERS

    // (different for mouse and touch events)

    const findDraggable = (element) => {
        if (element.classList.contains('draggable')) {
            return (element);
        }
        else {
            return (findDraggable(element.parentElement));
        }
    }

    const mouseStartDrag = (event) => {
        if (inDragMode) {
            mouseTarget = findDraggable(event.target);
            // we are now dragging something with the mouse
            mouseDragging = true;
            // bring the shape to the front of the canvas
            mouseTarget.parentNode.appendChild(mouseTarget);
            // startDrag
            startDrag(mouseTarget, getSVGPoint(event));
        }
    }

    const mouseDrag = (event) => {
        if (inDragMode) {
            if (mouseDragging) { // yes, we are dragging something
                drag(mouseTarget, getSVGPoint(event));
            }
        }
    }

    const mouseEndDrag = (event) => {
        if (inDragMode) {
            // fires when dragging is ended (by the user releasing the shape via mouseup)
            mouseDragging = false; // mark that dragging is no longer occurring
            mouseTarget = null;
        }
    }

    const touchStartDrag = (event) => {
        if (inDragMode) {
            event.preventDefault(); // Don't propogate this event. Wise?
            const touch = event.targetTouches[0];
            const obj = findDraggable(touch.target); //untested
            startDrag(obj, getSVGPoint(touch));
        }
    }

    const touchDrag = (event) => {
        if (inDragMode) {
            event.preventDefault(); // Don't propogate this event. Wise?
            const touch = event.targetTouches[0];
            const obj = findDraggable(touch.target);
            requestAnimationFrame(() => drag(obj, getSVGPoint(touch)));
        }
    }

    const triggerRecording = (event) => {
        if ((recordMode !== 'record') && recordEnabled && inDragMode) {
            if (recordMode === 'pause') {
                if (enableRecordingFromPause) {
                    startRecordingFromPause();
                }
                else {
                    startRecording();
                }
            }
            else if (recordMode === 'play') {
                if (enableRecordingDuringPlayback) {
                    pauseRecording();
                    startRecordingFromPause();
                }
            }
        }
    }

    // add event handlers
    for (const el of draggables) {
        el.addEventListener('mousedown', mouseStartDrag);
        el.addEventListener('touchstart', touchStartDrag);
        el.addEventListener('touchmove', touchDrag);
    }
    for (const el of recordables) {
        el.addEventListener('mousedown', triggerRecording);
        el.addEventListener('touchstart', triggerRecording);
    }

    svg.addEventListener('mousemove', mouseDrag);
    svg.addEventListener('mouseup', mouseEndDrag);

    // fix for scrolling in Android Chrome
    svg.style.touchAction = "none";


    return { // ES6 shorthand syntax

        enableDragging() {
            inDragMode = true;
        },

        disableDragging() {
            inDragMode = false;
        },

        enableRecording() {
            recordEnabled = true;
        },

        disableRecording() {
            recordEnabled = false;
            stopRecording();
        },

        clearRecording,

        clearRecordingFrom,

        recordStatus() {
            return recordMode === 'record';
        },

        getPositionData() {
            // return the object containing all shapes' position data
            return positionData;
        },

        getTrimmedPositionData, // position data within start & end times

        getRecordEndTime() {
            // return the last index in the position data (milliseconds)
            return recordEndTime;
        },

        loadPositionData(newData) {
            // load the given newData into positionData so that it can be played back
            positionData = newData;
            recordEndTime = getLastTimepoint();
        },

        startPlayback,

        startPlaybackFromPause,

        stopPlayback,

        pauseRecording,

        startRecordingFromPause,

        pausePlayback,

        seekTo,

        enableRecordingFromPause() {
            enableRecordingFromPause = true;
        },

        enableRecordingFromPlaybackEnd() {
            enableRecordingFromPlaybackEnd = true;
        },

        enableRecordingDuringPlayback() {
            enableRecordingDuringPlayback = true;
        },

        setRecordingTimeout(func, milliseconds) {
            timeoutFunction = func;
            timeoutMilliseconds = milliseconds;
        },

        reset() {
            pausePlayback();
            seekTo(0);
        },

        getRecordMode() {
            return recordMode;
        }, // 'pause', 'play', 'record', or 'overdub'

        elapsedTime // best guess of what millisecond we are at in the current recording

    }
}

// autostart

document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll('.draggables').forEach(svg => Rotodrag(svg).enableDragging());
});



// Polyfill for Chrome

SVGElement.prototype.getTransformToElement = SVGElement.prototype.getTransformToElement || function (elem) {
    return elem.getScreenCTM().inverse().multiply(this.getScreenCTM());
};
