// rotodrag.js
// A JavaScript library for svg object translation and rotoation
// using mouse or touch events.
// Copyright (c) 2018, University of Southern California
// BSD-2-Clause License

var rotodrag = function(svg) {

    // PRIVATE VARIABLES

    // Array of draggable svg elements
    if (svg.getElementsByClassName) { // fix for IE
	var draggables = svg.getElementsByClassName('draggable');
	var recordables = svg.getElementsByClassName('recordable');
    }
    else {
	var draggables = svg.querySelectorAll('.draggable');
	var recordables = svg.querySelectorAll('.recordable');
    }

    // print centers
    for (var i = 0; i < draggables.length; i++) {
	var bb = draggables[i].getBBox();
	console.log(bb.x + (bb.width * 0.5), bb.y + (bb.height * 0.5));
    }

    // Arrays store dragging data, indexed by position in draggables array;
    var transforms = {}; // initial transform attributes, indexed by name
    for (var i = 0; i < draggables.length; i++) {
	var o = draggables[i];
	o.transform.baseVal.consolidate();
        transforms[o.getAttribute("data-character-name")] = o.getAttribute('transform');
    }
    var dragStarts = []; // points on draggable objects
    var offsets = []; // points encoding distance to center point
    var offsetAngles = []; // angles from offset to center point


    // What mode are we in?
    var inDragMode = false; // default is no dragging
    var recordEnabled = false; // default is no recording
    var recordMode = 'pause'; // 'pause', 'play', 'record', or 'overdub'

    // Special variables needed for svg-level event handlers (mousemove)
    var mouseDragging = false; // True when mousedown on a draggable object
    var mouseTarget = null; // The object that is being dragged with a mouse

    // Recording and playback
    var player; // timer for playback
    var playbackInterval = 10; // milliseconds
    var playbackTimepoint; // where are we now?
    var pauseTimepoint = 0; // when did we pause?
    var positionData = {};
    var recordStartTime;
    var recordEndTime = 0; // highest timepoint in positionData;

    // Special recording modes
    var enableRecordingFromPause = false;
    var enableRecordingFromPlaybackEnd = false;
    var enableRecordingDuringPlayback = false;

    // Recording timeout function
    var timeoutID = null;
    var timeoutFunction = null;
    var timeoutMilliseconds = 0;

    // UTILITY FUNCTIONS

    var getIndex = function(obj) {
        // returns index of object in draggables array
        for (var i = 0; i < draggables.length; i++) {
            if (draggables[i] === obj) {
                return i;}
        }
        return(-1);
    }

    var getIndexByCharacterName = function(name) {
        for (var i = 0; i < draggables.length; i++) {
            if (draggables[i].getAttribute("data-character-name") == name) {
                return i;}
        }
        return(-1);
    }

    var isRecordable = function(obj) {
        for (var i = 0; i < recordables.length; i++) {
            if (recordables[i] === obj) {
                return true;}
        }
        return(false);
    }

    var getCenter = function(shape) {
        // return the center point of the given shape
        // assuming that its center is 0,0 with no transforms
        var pt = svg.createSVGPoint();
        return pt.matrixTransform(svg.getTransformToElement(shape).inverse());
    }

    var getRelativePoint = function(p1, p2) {
        // calculate p1 as a point relative to point p2, then return drag point
        var pt = svg.createSVGPoint();
        pt.x = p1.x - p2.x;
        pt.y = p1.y - p2.y;
        return(pt);
    }

    var addPoints = function(p1, p2) {
        //calculate the result of adding point p2 to point p1, then return drag point
        var pt = svg.createSVGPoint();
        pt.x = p1.x + p2.x;
        pt.y = p1.y + p2.y;
        return(pt);
    }

    var getSVGPoint = function(e) {
        // return the SVG point that corresponds to the touch/mouse event
        var posx = 0;
        var posy = 0;
        posx = e.clientX;
        posy = e.clientY;
        var pt = svg.createSVGPoint();
        pt.x = posx;
        pt.y = posy;
        return pt.matrixTransform(svg.getScreenCTM().inverse());
    }

    var getXYR = function(shape) {
	// Derived from https://gist.github.com/2052247
	var matrix = shape.transform.baseVal[0].matrix;
	res = {x: matrix.e,
	       y: matrix.f,
	       r: (180 / Math.PI) * Math.atan2(matrix.d, matrix.c) - 90};
	return res;
    }

    // DRAGGING FUNCTIONS

    // startDrag : initialize relevant dragging variables
    var startDrag = function(obj, svgPoint) {
        var i = getIndex(obj); // unique identifier
        // get the SVG point corresponding to the point where the shape was selected
        dragStarts[i] = svgPoint;
        // calculate the dragging start point relative to the object's
        // center point (and regardless of the shape's current rotation)
        offsets[i] = svgPoint.matrixTransform(svg.getTransformToElement(obj));
        // calculate the angle between the dragging start point and the shape's center point
        var o = Math.atan2(offsets[i].y, offsets[i].x) * 180 / Math.PI + 90;
        if (o < 0) {
            // if the angle is less than 0, add a full rotation for human readability
            offsetAngles[i] = o + 360;}
        else {
            offsetAngles[i] = o;}
        // fire event
        var evt = document.createEvent('CustomEvent');
        evt.initCustomEvent('draggableStartDrag', false, false, null);
        svg.dispatchEvent(evt);
    }

    // drag : calculate relative changes
    var drag = function(obj, dragEnd) {
        var i = getIndex(obj); // unique identifier
        // get the center point of the current position of the shape
        var center = getCenter(obj);
        // get the coordinates of the new dragging point relative to the current center point
        var relativeDragEnd = getRelativePoint(dragEnd, center);
        // calculate the angle between the new dragging point and the center point
        var relativeAngle = Math.atan2(relativeDragEnd.y, relativeDragEnd.x) * 180 / Math.PI + 90;
        if (relativeAngle < 0) {
            relativeAngle = relativeAngle + 360; } // for human clarity
        // adjust the angle of rotation by subtracting the angle between the dragging start point and the center point
        var rotation = relativeAngle - offsetAngles[i];
        //call moveTo() to move the shape based on the above calculations
        moveTo(obj, dragEnd, rotation, offsets[i]);
    }

    // moveTo : update the transform attribute, handle special cases
    var moveTo = function(shape, dragEnd, rotation, offset) {
        // translate and rotate the given shape according to the given values
        if (rotation < 0) { rotation = rotation + 360; } // human clarity
        var transformString;
        var slipRadius = parseFloat(shape.getAttribute('data-slip-radius'))  || 100;
        var distance =           Math.sqrt(Math.pow(offset.x,2) + Math.pow(offset.y,2));
        if (shape.getAttribute('data-dragstyle') === 'rotate') {
            var above = parseFloat(shape.getAttribute('data-rotate-above')) || 0;
            var below = parseFloat(shape.getAttribute('data-rotate-below')) || 360;
            var posx = parseFloat(shape.getAttribute('data-fixed-x'));
            var posy = parseFloat(shape.getAttribute('data-fixed-y'));
            if ((rotation < above) && (rotation > below)) {
                transformString = shape.getAttribute('transform'); // don't move
            }
            else {
                transformString = "translate(" + posx + ", " + posy + ") " + "rotate (" + rotation + ") ";
            }
        }
        else if ((shape.getAttribute('data-dragstyle') === 'slippery') &&
                 (Math.sqrt(Math.pow(offset.x,2) + Math.pow(offset.y,2)) < slipRadius)) {
            transformString = shape.getAttribute('transform'); // don't move
            slipTo(shape, dragEnd);
        }
        else if (shape.getAttribute('data-dragstyle') === 'xaxis') {
            var posy = parseFloat(shape.getAttribute('data-fixed-y'));
            var posx = dragEnd.x + (offset.x * -1);
            var minx = parseFloat(shape.getAttribute('data-min-x'));
            var maxx = parseFloat(shape.getAttribute('data-max-x'));
            if (posx < minx) {posx = minx;}
            if (posx > maxx) {posx = maxx;}
            transformString = "translate(" + posx + ", " + posy + ") ";
        }
        else {
            transformString = "translate(" + dragEnd.x + ", " + dragEnd.y + ") " + "rotate (" + rotation + ") " + "translate(" + (offset.x * -1) + ", " + (offset.y * -1) + ") ";
        }

        shape.setAttributeNS(null, "transform", transformString);
	shape.transform.baseVal.consolidate();
        if ((recordMode === 'record') && isRecordable(shape)) {
            continueRecording();
        }
    }

    // slipTo : handle sippery centers, update relevant dragging variables
    var slipTo = function(shape, point) {
        // Could be fancier, but this works:
        startDrag(shape, point);

    }

    // RECORDING FUNCTIONS

    var startRecording = function(offset) {
        // offset of optional argument
        if (typeof(offset) === 'undefined') offset = 0; // beginning is default
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
        if (offset ===  0) {
            continueRecording();
        }
    }

    var startRecordingFromPause = function() {
        clearRecordingFrom(pauseTimepoint);
        startRecording(pauseTimepoint);
    }

    var continueRecording = function() {
        //get the recording timepoint by determining how much time has elapsed since recording began,
        recordTimepoint = new Date().getTime() - recordStartTime;
        // then call record() to save the position data for this timepoint
        record(recordTimepoint);
    }

    var stopRecording = function() {
        // end recording by setting the recording boolean to false
        //inRecordMode = false;
        recordMode = 'pause';
        if (timeoutFunction != null) {
            window.clearTimeout(timeoutID);
        }
    }

    var pauseRecording = function() {
        // what time is it?
        pauseTimepoint = elapsedTime();
        // pause recording by setting the recording boolean to false, but leave any timer running
        //inRecordMode = false;
        recordMode = 'pause';
        // maybe make a more sophistocated timer sometime in the future?
    }

    var clearRecording = function() {
	pausePlayback();
	seekTo(0); // move objects back to start
        positionData = {}; // clear position data
        record(0); // set zero point
    }

    var clearRecordingFrom = function(killPoint) {
        // erase all position data beyond a given timepoint, in milliseconds
        var biggest = 0;
        for (var prop in positionData) {
            if (positionData.hasOwnProperty(prop)) {
                timepoint = parseInt(prop);
                if (timepoint >= killPoint) {
                    delete positionData[prop];
                }
                else if (timepoint > biggest) {
                    biggest = timepoint;
                }
            }
        }
        recordEndTime = biggest;
    }

    var record = function(timePoint) {
        //record the position of all shapes at the given timepoint in the positionData object
        positionData[timePoint] = {};
        var name, transform;
        for (var i = 0; i < recordables.length; i++) {
            name = recordables[i].getAttribute("data-character-name");
            transform = recordables[i].getAttribute("transform");
            positionData[timePoint][name] = transform;
        }
        if (timePoint > recordEndTime) {
            recordEndTime = timePoint; }
    }

    record(0); // initialize position data

    var getTrimmedPositionData = function(start, end) {
	var oriT; // original timepoint
	var adjT;  //adjusted timepoint
	var result = {}; // new position data object

	// start with the 0 position
	var oneBefore = getClosestTimepoint(getSortedTimepoints(), start, 0); // positioning before start
	result['0'] = positionData[oneBefore];
	
	// then fill in the rest
	for (var prop in positionData) {
            if (positionData.hasOwnProperty(prop)) {
                oriT = parseInt(prop);
                if ((oriT >= start) && (oriT <= end)) { // within range
		    adjT = oriT - start;
		    result[adjT] = positionData[oriT];
		}
	    }
	}
	return result;
    }
		    


    // PLAYBACK FUNCTIONS

    var startPlayback = function(offset) {
        // offset of optional argument
        if (typeof(offset) === 'undefined') offset = 0; // beginning is default
        // initialize playback by ending the current playback (if needed)
        stopPlayback(); //end previous playback before starting new
        var playbackStartTime = new Date().getTime();
        // and then setting up a player that will retrieve position data every 10 milliseconds
        // and display the position at that timepoint
        var sortedTimepoints = getSortedTimepoints();
        player = setInterval(function() {
            if (recordMode === 'play') { // insurance, because sometimes timers persist, maybe?
                playbackTimepoint = new Date().getTime() - playbackStartTime + offset;
                playbackTimepointProperty = getClosestTimepoint(sortedTimepoints, playbackTimepoint, 0);
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

    var startPlaybackFromPause = function() {
        startPlayback(pauseTimepoint);
    }

    var playback = function(timePoint) {
        // configure recordable characters to match the positions
        // at the given timepoint
        for (var name in positionData[timePoint]) {
            var transform = positionData[timePoint][name];
            var element = draggables[getIndexByCharacterName(name)];
            element.setAttributeNS(null, "transform", transform);
        }
    }

    var stopPlayback = function() { //end playback by clearing the player
        if (player != undefined) {
            clearInterval(player);
        }
        recordMode = 'pause';
    }

    var pausePlayback = function() { //end playback by clearing the player
        // what time is it?
        pauseTimepoint = elapsedTime();
        if (player != undefined) {
            clearInterval(player);
        }
        recordMode = 'pause';
    }

    var seekTo = function(milliseconds) { // should only be used when in pause mode
        if (recordMode === 'pause') {
            var sortedTimepoints = getSortedTimepoints();
            var playbackTimepointProperty = getClosestTimepoint(sortedTimepoints, milliseconds, 0);
            playback(playbackTimepointProperty);
            pauseTimepoint = milliseconds;
        }
    }

    var getSortedTimepoints = function() {
        // get all timepoints that positionData has recordings for,
        var timepoints = [];
        for (var timepoint in positionData) {
            if (positionData.hasOwnProperty(timepoint)) {
                timepoints.push(parseInt(timepoint));
            }
        }
        // and then return them in a sorted array so that the player can iterate through them
        timepoints.sort(function(a,b) {return a-b});
        return timepoints;
    }

    var getClosestTimepoint = function(sortedTimepoints, targetTimepoint, startIndex){
	if (targetTimepoint > recordEndTime) {return recordEndTime;}
        // use binary search to return the timepoint in positionData that occurs
        // directly before the given targetTimepoint
        var stopIndex   = sortedTimepoints.length - 1;
        var middle      = Math.floor((stopIndex + startIndex)/2);
        if (targetTimepoint >= sortedTimepoints[stopIndex]) {
            return stopIndex;
        }
        var targetRangeMin = sortedTimepoints[middle];
        var targetRangeMax = sortedTimepoints[middle + 1];

        while (targetTimepoint < targetRangeMin || targetTimepoint >= targetRangeMax && startIndex < stopIndex){
            //adjust search area
            if (targetTimepoint < sortedTimepoints[middle]){
                stopIndex = middle - 1;
            } else if (targetTimepoint >= sortedTimepoints[middle + 1]){
                startIndex = middle + 1;
            }
            //recalculate middle
            middle = Math.floor((stopIndex + startIndex)/2);
            targetRangeMin = sortedTimepoints[middle];
            targetRangeMax = sortedTimepoints[middle + 1];
        }
        return sortedTimepoints[middle];
    }

    var getLastTimepoint = function() {
	var sorted = getSortedTimepoints();
	var index = sorted.length - 1;
	return sorted[index];
    }

    var elapsedTime = function() {
        // dependent on recordMode
        if (recordMode === 'record') {
            return (new Date().getTime() - recordStartTime);}
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

    var findDraggable = function(element) {
	if (element.classList.contains('draggable')) {
	    return(element);
	}
	else {
	    return (findDraggable(element.parentElement));
	}
    }

    var mouseStartDrag = function(event) {
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

    var mouseDrag = function(event) {
        if (inDragMode) {
            if (mouseDragging ===  true) { // yes, we are dragging something
                drag(mouseTarget, getSVGPoint(event));
            }
        }
    }

    var mouseEndDrag = function(event) {
        if (inDragMode) {
            // fires when dragging is ended (by the user releasing the shape via mouseup)
            mouseDragging = false; // mark that dragging is no longer occurring
            mouseTarget = null;
        }
    }

    var touchStartDrag = function(event) {
        if (inDragMode) {
            event.preventDefault(); // Don't propogate this event. Wise?
            var touchData = event.targetTouches;
            var touch = touchData[0];
            var obj = findDraggable(touch.target); //untested
            startDrag(obj, getSVGPoint(touch));
        }
    }

    var touchDrag = function(event) {
        if (inDragMode) {
            event.preventDefault(); // Don't propogate this event. Wise?
            var touchData = event.targetTouches;
            var touch = touchData[0];
            var obj = findDraggable(touch.target);
            requestAnimationFrame(function() {
                drag(obj, getSVGPoint(touch));
            });
        }
    }

    var triggerRecording = function(event) {
        if ((recordMode !== 'record') && recordEnabled && inDragMode) {
            if (recordMode === 'pause') {
                if (enableRecordingFromPause) {
                    startRecordingFromPause(); }
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
    for (var i = 0; i < draggables.length; i++) {
        draggables[i].addEventListener('mousedown', mouseStartDrag);
        draggables[i].addEventListener('touchstart', touchStartDrag);
        draggables[i].addEventListener('touchmove', touchDrag);
    }
    for (var i = 0; i < recordables.length; i++) {
        recordables[i].addEventListener('mousedown', triggerRecording);
        recordables[i].addEventListener('touchstart', triggerRecording);
    }
    svg.addEventListener('mousemove', mouseDrag);
    svg.addEventListener('mouseup', mouseEndDrag);

    // fix for scrolling in Android Chrome
    svg.style.touchAction = "none";


    return {

        enableDragging : function() {
            inDragMode = true;
        },

        disableDragging : function() {
            inDragMode = false;
        },

        enableRecording : function() {
            recordEnabled = true;
        },

        disableRecording : function() {
            recordEnabled = false;
            stopRecording();
        },

        clearRecording : clearRecording,

        clearRecordingFrom : clearRecordingFrom,

        recordStatus : function() {
            if (recordMode = 'record') {
                return true;}
            else {
                return false;}
        },

        getPositionData: function() {
            // return the object containing all shapes' position data
            return positionData;
        },

	getTrimmedPositionData : getTrimmedPositionData, // position data within start & end times

        getRecordEndTime: function() {
            // return the last index in the position data (milliseconds)
            return recordEndTime;
        },

        loadPositionData: function(newData) {
            // load the given newData into positionData so that it can be played back
            positionData = newData;
	    recordEndTime = getLastTimepoint();
        },

        startPlayback : startPlayback,

        startPlaybackFromPause : startPlaybackFromPause,

        stopPlayback : stopPlayback,

        pauseRecording : pauseRecording,

        startRecordingFromPause : startRecordingFromPause,

        pausePlayback : pausePlayback,

        seekTo : seekTo,

        enableRecordingFromPause : function() {
            enableRecordingFromPause = true;
        },

        enableRecordingFromPlaybackEnd : function() {
            enableRecordingFromPlaybackEnd = true;
        },

        enableRecordingDuringPlayback : function() {
            enableRecordingDuringPlayback = true;
        },

        setRecordingTimeout : function(func, milliseconds) {
            timeoutFunction = func;
            timeoutMilliseconds = milliseconds;
        },

        reset : function() {
	    pausePlayback();
	    seekTo(0);
        },

        getRecordMode : function() {
            return recordMode;
        }, // 'pause', 'play', 'record', or 'overdub'

        elapsedTime : elapsedTime // best guess of what millisecond we are at in the current recording

    }
}

// autostart

document.addEventListener("DOMContentLoaded", function() {
    var svgs = document.querySelectorAll('.draggables');
    [].forEach.call(svgs, function(svg) {
	rotodrag(svg).enableDragging();
    });
});

// Polyfill for Chrome

SVGElement.prototype.getTransformToElement = SVGElement.prototype.getTransformToElement || function(elem) {
    return elem.getScreenCTM().inverse().multiply(this.getScreenCTM());
};
