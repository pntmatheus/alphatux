/*
Here is the list of the major difference with other autocomplete scripts:

- don't do anything but fire a signal when a choice is selected: it's
left as an exercise to the developer to implement whatever he wants when
that happens
- don't generate the autocomplete HTML, it should be generated by the server

Let's establish the vocabulary used in this script, so that we speak the
same language:

- The text input element is "input",
- The box that contains a list of choices is "box",
- Each result in the "autocomplete" is a "choice",
- With a capital A, "Autocomplete", is the class or an instance of the
class.

Here is a fantastic schema in ASCII art:

    +---------------------+ <----- Input
    | Your city name ? <---------- Placeholder
    +---------------------+
    | Paris, France       | <----- Autocomplete
    | Paris, TX, USA      |
    | Paris, TN, USA      |
    | Paris, KY, USA <------------ Choice
    | Paris, IL, USA      |
    +---------------------+

This script defines three signals:

- hilightChoice: when a choice is hilight, or that the user
navigates into a choice with the keyboard,
- dehilightChoice: when a choice was hilighed, and that the user
navigates into another choice with the keyboard or mouse,
- selectChoice: when the user clicks on a choice, or that he pressed
enter on a hilighted choice.

They all work the same, here's a trivial example:

  $('#your-autocomplete').bind(
      'selectChoice',
      function(e, choice, autocomplete) {
          alert('You selected: ' + choice.html());
      }
  );

Note that 'e' is the variable containing the event object.

Also, note that this script is composed of two main parts:

- The Autocomplete class that handles all interaction, defined as
`Autocomplete`,
- The jQuery plugin that manages Autocomplete instance, defined as
`$.fn.yourlabsAutocomplete`
*/

if (window.isOpera === undefined) {
    var isOpera = (navigator.userAgent.indexOf('Opera')>=0) && parseFloat(navigator.appVersion);
}

if (window.isIE === undefined) {
    var isIE = ((document.all) && (!isOpera)) && parseFloat(navigator.appVersion.split('MSIE ')[1].split(';')[0]);
}

if (window.findPosX === undefined) {
    window.findPosX = function(obj) {
        var curleft = 0;
        if (obj.offsetParent) {
            while (obj.offsetParent) {
                curleft += obj.offsetLeft - ((isOpera) ? 0 : obj.scrollLeft);
                obj = obj.offsetParent;
            }
            // IE offsetParent does not include the top-level
            if (isIE && obj.parentElement){
                curleft += obj.offsetLeft - obj.scrollLeft;
            }
        } else if (obj.x) {
            curleft += obj.x;
        }
        return curleft;
    }
}

if (window.findPosY === undefined) {
    window.findPosY = function(obj) {
        var curtop = 0;
        if (obj.offsetParent) {
            while (obj.offsetParent) {
                curtop += obj.offsetTop - ((isOpera) ? 0 : obj.scrollTop);
                obj = obj.offsetParent;
            }
            // IE offsetParent does not include the top-level
            if (isIE && obj.parentElement){
                curtop += obj.offsetTop - obj.scrollTop;
            }
        } else if (obj.y) {
            curtop += obj.y;
        }
        return curtop;
    }
}

// Our class will live in the yourlabs global namespace.
if (window.yourlabs === undefined) window.yourlabs = {};

// Fix #25: Prevent accidental inclusion of autocomplete_light/static.html
if (window.yourlabs.Autocomplete !== undefined)
    console.log('WARNING ! You are loading autocomplete.js **again**.');

yourlabs.getInternetExplorerVersion = function()
// Returns the version of Internet Explorer or a -1
// (indicating the use of another browser).
{
  var rv = -1; // Return value assumes failure.
  if (navigator.appName === 'Microsoft Internet Explorer')
  {
    var ua = navigator.userAgent;
    var re  = new RegExp('MSIE ([0-9]{1,}[.0-9]{0,})');
    if (re.exec(ua) !== null)
      rv = parseFloat( RegExp.$1 );
  }
  return rv;
};

$.fn.yourlabsRegistry = function(key, value) {
    var ie = yourlabs.getInternetExplorerVersion();

    if (ie === -1 || ie > 8) {
        // If not on IE8 and friends, that's all we need to do.
        return value === undefined ? this.data(key) : this.data(key, value);
    }

    if ($.fn.yourlabsRegistry.data === undefined) {
        $.fn.yourlabsRegistry.data = {};
    }

    if ($.fn.yourlabsRegistry.guid === undefined) {
        $.fn.yourlabsRegistry.guid = function() {
            return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(
                /[xy]/g,
                function(c) {
                    var r = Math.random()*16|0, v = c === 'x' ? r : (r&0x3|0x8);
                    return v.toString(16);
                }
            );
        };
    }

    var attributeName = 'data-yourlabs-' + key + '-registry-id';
    var id = this.attr(attributeName);

    if (id === undefined) {
        id = $.fn.yourlabsRegistry.guid();
        this.attr(attributeName, id);
    }

    if (value !== undefined) {
        $.fn.yourlabsRegistry.data[id] = value;
    }

    return $.fn.yourlabsRegistry.data[id];
};

/*
The autocomplete class constructor:

- takes a takes a text input element as argument,
- sets attributes and methods for this instance.

The reason you want to learn about all this script is that you will then be
able to override any variable or function in it on a case-per-case basis.
However, overriding is the job of the jQuery plugin so the procedure is
described there.
*/
yourlabs.Autocomplete = function (input) {
    /*
    The text input element that should have an autocomplete.
    */
    this.input = input;

    // The value of the input. It is kept as an attribute for optimisation
    // purposes.
    this.value = '';

    /*
    It is possible to wait until a certain number of characters have been
    typed in the input before making a request to the server, to limit the
    number of requests.

    However, you may want the autocomplete to behave like a select. If you
    want that a simple click shows the autocomplete, set this to 0.
     */
    this.minimumCharacters = 2;

    /*
    In a perfect world, we would hide the autocomplete when the input looses
    focus (on blur). But in reality, if the user clicks on a choice, the
    input looses focus, and that would hide the autocomplete, *before* we
    can intercept the click on the choice.

    When the input looses focus, wait for this number of milliseconds before
    hiding the autocomplete.
     */
    this.hideAfter = 200;

    /*
    The server should have a URL that takes the input value, and responds
    with the list of choices as HTML. In most cases, an absolute URL is
    better.
     */
    this.url = false;

    /*
    Although this script will make sure that it doesn't have multiple ajax
    requests at the time, it also supports debouncing.

    Set a number of milliseconds here, it is the number of milliseconds that it
    will wait before querying the server. The higher it is, the less it will
    spam the server but the more the user will wait.
    */
    this.xhrWait = 200;

    /*
    As the server responds with plain HTML, we need a selector to find the
    choices that it contains.

    For example, if the URL returns an HTML body where every result is in a
    div of class "choice", then this should be set to '.choice'.
     */
    this.choiceSelector = '.choice';

    /*
    When the user hovers a choice, it is nice to hilight it, for
    example by changing it's background color. That's the job of CSS code.

    However, the CSS can not depend on the :hover because the user can
    hilight choices with the keyboard by pressing the up and down
    keys.

    To counter that problem, we specify a particular class that will be set
    on a choice when it's 'hilighted', and unset when it's
    'dehilighted'.
     */
    this.hilightClass = 'hilight';

    /*
    The value of the input is passed to the server via a GET variable. This
    is the name of the variable.
     */
    this.queryVariable = 'q';

    /*
    This dict will also be passed to the server as GET variables.

    If this autocomplete depends on another user defined value, then the
    other user defined value should be set in this dict.

    Consider a country select and a city autocomplete. The city autocomplete
    should only fetch city choices that are in the selected country. To
    achieve this, update the data with the value of the country select:

        $('select[name=country]').change(function() {
            $('city[name=country]').yourlabsAutocomplete().data = {
                country: $(this).val(),
            }
        });
     */
    this.data = {};

    /*
    To avoid several requests to be pending at the same time, the current
    request is aborted before a new one is sent. This attribute will hold the
    current XMLHttpRequest.
     */
    this.xhr = false;

    /*
    fetch() keeps a copy of the data sent to the server in this attribute. This
    avoids double fetching the same autocomplete.
     */
    this.lastData = {};

    // The autocomplete box HTML.
    this.box = $('<span class="yourlabs-autocomplete" ' +
        'data-input-id="' + this.input.attr('id') + '"></span>');

    /*
    We'll append the box to the container and calculate an absolute position
    every time the autocomplete is shown in the fixPosition method.

    By default, this traverses this.input's parents to find the nearest parent
    with an 'absolute' or 'fixed' position. This prevents scrolling issues. If
    we can't find a parent that would be correct to append to, default to
    <body>.
    */
    this.container = this.input.parents().filter(function() {
        return ['absolute', 'fixed'].indexOf($(this).css('position')) > -1;
    }).first();
    if (!this.container.length) this.container = $('body');
};

/*
Rather than directly setting up the autocomplete (DOM events etc ...) in
the constructor, setup is done in this method. This allows to:

- instanciate an Autocomplete,
- override attribute/methods of the instance,
- and *then* setup the instance.
 */
yourlabs.Autocomplete.prototype.initialize = function() {
    var ie = yourlabs.getInternetExplorerVersion();

    this.input
        .on('blur.autocomplete', $.proxy(this.inputBlur, this))
        .on('focus.autocomplete', $.proxy(this.inputClick, this))
        .on('keydown.autocomplete', $.proxy(this.inputKeyup, this));

    $(window).on('resize', $.proxy(function() {
        if (this.box.is(':visible')) this.fixPosition();
    }, this));

    if (ie === -1 || ie > 9) {
        this.input.on('input.autocomplete', $.proxy(this.refresh, this));
    }
    else
    {
        var events = [
            'keyup.autocomplete',
            'keypress.autocomplete',
            'cut.autocomplete',
            'paste.autocomplete'
        ]

        this.input.on(events.join(' '), function($e) {
            $.proxy(this.inputKeyup, this);
        })
    }

    /*
    Bind mouse events to fire signals. Because the same signals will be
    sent if the user uses keyboard to work with the autocomplete.
     */
    this.box
        .on('mouseenter', this.choiceSelector, $.proxy(this.boxMouseenter, this))
        .on('mouseleave', this.choiceSelector, $.proxy(this.boxMouseleave, this))
        .on('mousedown', this.choiceSelector, $.proxy(this.boxClick, this));

    /*
    Initially - empty data queried
    */
    this.data[this.queryVariable] = '';
};

// Unbind callbacks on input.
yourlabs.Autocomplete.prototype.destroy = function(input) {
    input
        .unbind('blur.autocomplete')
        .unbind('focus.autocomplete')
        .unbind('input.autocomplete')
        .unbind('keydown.autocomplete')
        .unbind('keypress.autocomplete')
        .unbind('keyup.autocomplete')
};

yourlabs.Autocomplete.prototype.inputBlur = function(e) {
    window.setTimeout($.proxy(this.hide, this), this.hideAfter);
};

yourlabs.Autocomplete.prototype.inputClick = function(e) {
    if (this.value.length >= this.minimumCharacters)
        this.show();
};

// When mouse enters the box:
yourlabs.Autocomplete.prototype.boxMouseenter = function(e) {
    // ... the first thing we want is to send the dehilight signal
    // for any hilighted choice ...
    var current = this.box.find('.' + this.hilightClass);

    this.input.trigger('dehilightChoice',
        [current, this]);

    // ... and then sent the hilight signal for the choice.
    this.input.trigger('hilightChoice',
        [$(e.currentTarget), this]);
};

// When mouse leaves the box:
yourlabs.Autocomplete.prototype.boxMouseleave = function(e) {
    // Send dehilightChoice when the mouse leaves a choice.
    this.input.trigger('dehilightChoice',
        [this.box.find('.' + this.hilightClass), this]);
};

// When mouse clicks in the box:
yourlabs.Autocomplete.prototype.boxClick = function(e) {
    var current = this.box.find('.' + this.hilightClass);

    this.input.trigger('selectChoice', [current, this]);
};

// Return the value to pass to this.queryVariable.
yourlabs.Autocomplete.prototype.getQuery = function() {
    // Return the input's value by default.
    return this.input.val();
};

yourlabs.Autocomplete.prototype.inputKeyup = function(e) {
    if (!this.input.is(':visible'))
        // Don't handle keypresses on hidden inputs (ie. with limited choices)
        return;

    switch(e.keyCode) {
        case 40: // down arrow
        case 38: // up arrow
        case 16: // shift
        case 17: // ctrl
        case 18: // alt
            this.move(e);
            break;

        case 9: // tab
        case 13: // enter
            if (!this.box.is(':visible')) return;

            var choice = this.box.find('.' + this.hilightClass);

            if (!choice.length) {
                // Don't get in the way, let the browser submit form or focus
                // on next element.
                return;
            }

            e.preventDefault();
            e.stopPropagation();

            this.input.trigger('selectChoice', [choice, this]);
            break;

        case 27: // escape
            if (!this.box.is(':visible')) return;
            this.hide();
            break;

        default:
            this.refresh();
    }
};

// This function is in charge of ensuring that a relevant autocomplete is
// shown.
yourlabs.Autocomplete.prototype.show = function(html) {
    // First recalculate the absolute position since the autocomplete may
    // have changed position.
    this.fixPosition();

    // Is autocomplete empty ?
    var empty = $.trim(this.box.find(this.choiceSelector)).length === 0;

    // If the inner container is empty or data has changed and there is no
    // current pending request, rely on fetch(), which should show the
    // autocomplete as soon as it's done fetching.
    if ((this.hasChanged() || empty) && !this.xhr) {
        this.fetch();
        return;
    }

    // And actually, fetch() will call show() with the response
    // body as argument.
    if (html !== undefined) {
        this.box.html(html);
    }

    // Don't display empty boxes.
    if (this.box.is(':empty')) {
        if (this.box.is(':visible')) {
            this.hide();
        }
        return;
    }

    var current = this.box.find('.' + this.hilightClass);
    var first = this.box.find(this.choiceSelector + ':first');
    if (first && !current.length) {
        first.addClass(this.hilightClass);
    }

    // Show the inner and outer container only if necessary.
    if (!this.box.is(':visible')) {
        this.box.css('display', 'block');
    }
};

// This function is in charge of the opposite.
yourlabs.Autocomplete.prototype.hide = function() {
    this.box.hide();
};

// This function is in charge of hilighting the right result from keyboard
// navigation.
yourlabs.Autocomplete.prototype.move = function(e) {
    // If the autocomplete should not be displayed then return.
    if (this.value.length < this.minimumCharacters) return true;

    // The current choice if any.
    var current = this.box.find('.' + this.hilightClass);

    // Prevent default browser behaviours on TAB and RETURN if a choice is
    // hilighted.
    if ($.inArray(e.keyCode, [9,13]) > -1 && current.length) {
        e.preventDefault();
    }

    // If not KEY_UP or KEY_DOWN, then return.
    // NOTE: with Webkit, both keyCode and charCode are set to 38/40 for &/(.
    //       charCode is 0 for arrow keys.
    //       Ref: http://stackoverflow.com/a/12046935/15690
    var way;
    if (e.keyCode === 38 && !e.charCode) way = 'up';
    else if (e.keyCode === 40 && !e.charCode) way = 'down';
    else return;

    // The first and last choices. If the user presses down on the last
    // choice, then the first one will be hilighted.
    var first = this.box.find(this.choiceSelector + ':first');
    var last = this.box.find(this.choiceSelector + ':last');

    // The choice that should be hilighted after the move.
    var target;

    // The autocomplete must be shown so that the user sees what choice
    // he is hilighting.
    this.show();

    // If a choice is currently hilighted:
    if (current.length) {
        if (way === 'up') {
            // The target choice becomes the first previous choice.
            target = current.prevAll(this.choiceSelector + ':first');

            // If none, then the last choice becomes the target.
            if (!target.length) target = last;
        } else {
            // The target choice becomes the first  next** choice.
            target = current.nextAll(this.choiceSelector + ':first');

            // If none, then the first choice becomes the target.
            if (!target.length) target = first;
        }

        // Trigger dehilightChoice on the currently hilighted choice.
        this.input.trigger('dehilightChoice',
            [current, this]);
    } else {
        target = way === 'up' ? last : first;
    }

    // Avoid moving the cursor in the input.
    e.preventDefault();

    // Trigger hilightChoice on the target choice.
    this.input.trigger('hilightChoice',
        [target, this]);
};

/*
Calculate and set the outer container's absolute positionning. We're copying
the system from Django admin's JS widgets like the date calendar, which means:

- the autocomplete box is an element appended to this.co,
- 
*/
yourlabs.Autocomplete.prototype.fixPosition = function() {
    var el = this.input.get(0)

    var zIndex = this.input.parents().filter(function() {
        return $(this).css('z-index') !== 'auto' && $(this).css('z-index') !== 0;
    }).first().css('z-index');

    this.box.appendTo(this.container).css({
        position: 'absolute',
        minWidth: parseInt(this.input.outerWidth()),
        top: (findPosY(el) + this.input.outerHeight()) + 'px',
        left: findPosX(el) + 'px',
        zIndex: zIndex
    });
};

// Proxy fetch(), with some sanity checks.
yourlabs.Autocomplete.prototype.refresh = function() {
    // Set the new current value.
    this.value = this.getQuery();

    // If the input doesn't contain enought characters then abort, else fetch.
    if (this.value.length < this.minimumCharacters)
      this.hide();
    else
      this.fetch();
};

// Return true if the data for this query has changed from last query.
yourlabs.Autocomplete.prototype.hasChanged = function() {
    for(var key in this.data) {
        if (!(key in this.lastData) || this.data[key] !== this.lastData[key]) {
            return true;
        }
    }
    return false;
};

// Manage requests to this.url.
yourlabs.Autocomplete.prototype.fetch = function() {
    // Add the current value to the data dict.
    this.data[this.queryVariable] = this.value;

    // Ensure that this request is different from the previous one
    if (!this.hasChanged()) {
        // Else show the same box again.
        this.show();
        return;
    }

    this.lastData = {};
    for(var key in this.data) {
        this.lastData[key] = this.data[key];
    }

    // Abort any current request.
    if (this.xhr) this.xhr.abort();

    // Abort any request that we planned to make.
    if (this.timeoutId) clearTimeout(this.timeoutId);

    // Make an asynchronous GET request to this.url in this.xhrWait ms
    this.timeoutId = setTimeout($.proxy(this.makeXhr, this), this.xhrWait);
};

// Wrapped ajax call to use with setTimeout in fetch().
yourlabs.Autocomplete.prototype.makeXhr = function() {
    this.input.addClass('xhr-pending');

    this.xhr = $.ajax(this.url, {
        type: 'GET',
        data: this.data,
        complete: $.proxy(this.fetchComplete, this)
    });
};

// Callback for the ajax response.
yourlabs.Autocomplete.prototype.fetchComplete = function(jqXHR, textStatus) {
    this.input.removeClass('xhr-pending');

    if (this.xhr === jqXHR) this.xhr = false;
    if (textStatus === 'abort') return;
    this.show(jqXHR.responseText);
};

/*
The jQuery plugin that manages Autocomplete instances across the various
inputs. It is named 'yourlabsAutocomplete' rather than just 'autocomplete'
to live happily with other plugins that may define an autocomplete() jQuery
plugin.

It takes an array as argument, the array may contain any attribute or
function that should override the Autocomplete builtin. For example:

  $('input#your-autocomplete').yourlabsAutocomplete({
      url: '/some/url/',
      hide: function() {
          this.outerContainer
      },
  })

Also, it implements a simple identity map, which means that:

  // First call for an input instanciates the Autocomplete instance
  $('input#your-autocomplete').yourlabsAutocomplete({
      url: '/some/url/',
  });

  // Other calls return the previously created Autocomplete instance
  $('input#your-autocomplete').yourlabsAutocomplete().data = {
      newData: $('#foo').val(),
  }

To destroy an autocomplete, call yourlabsAutocomplete('destroy').
*/
$.fn.yourlabsAutocomplete = function(overrides) {
    if (this.length < 1) {
        // avoid crashing when called on a non existing element
        return;
    }

    overrides = overrides ? overrides : {};
    var autocomplete = this.yourlabsRegistry('autocomplete');

    if (overrides === 'destroy') {
        if (autocomplete) {
            autocomplete.destroy(this);
            this.removeData('autocomplete');
        }
        return;
    }

    // Disable the browser's autocomplete features on that input.
    this.attr('autocomplete', 'off');

    // If no Autocomplete instance is defined for this id, make one.
    if (autocomplete === undefined) {
        // Instanciate Autocomplete.
        autocomplete = new yourlabs.Autocomplete(this);

        // Extend the instance with data-autocomplete-* overrides
        for (var key in this.data()) {
            if (!key) continue;
            if (key.substr(0, 12) !== 'autocomplete' || key === 'autocomplete')
                continue;
            var newKey = key.replace('autocomplete', '');
            newKey = newKey.charAt(0).toLowerCase() + newKey.slice(1);
            autocomplete[newKey] = this.data(key);
        }

        // Extend the instance with overrides.
        autocomplete = $.extend(autocomplete, overrides);

        if (!autocomplete.url) {
            alert('Autocomplete needs a url !');
            return;
        }

        this.yourlabsRegistry('autocomplete', autocomplete);

        // All set, call initialize().
        autocomplete.initialize();
    }

    // Return the Autocomplete instance for this id from the registry.
    return autocomplete;
};

// Binding some default behaviors.
$(document).ready(function() {
    function removeHilightClass(e, choice, autocomplete) {
        choice.removeClass(autocomplete.hilightClass);
    }
    $(document).bind('hilightChoice', function(e, choice, autocomplete) {
        choice.addClass(autocomplete.hilightClass);
    });
    $(document).bind('dehilightChoice', removeHilightClass);
    $(document).bind('selectChoice', removeHilightClass);
    $(document).bind('selectChoice', function(e, choice, autocomplete) {
        autocomplete.hide();
    });
});
