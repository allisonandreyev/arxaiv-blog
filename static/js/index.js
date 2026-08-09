window.HELP_IMPROVE_VIDEOJS = false;

var INTERP_BASE = "./static/interpolation/stacked";
var NUM_INTERP_FRAMES = 240;

var interp_images = [];
function preloadInterpolationImages() {
  for (var i = 0; i < NUM_INTERP_FRAMES; i++) {
    var path = INTERP_BASE + '/' + String(i).padStart(6, '0') + '.jpg';
    interp_images[i] = new Image();
    interp_images[i].src = path;
  }
}

function setInterpolationImage(i) {
  var image = interp_images[i];
  image.ondragstart = function() { return false; };
  image.oncontextmenu = function() { return false; };
  $('#interpolation-image-wrapper').empty().append(image);
}

function buildFileList(prefix, count) {
  var files = [];
  for (var i = 1; i <= count; i++) {
    files.push(prefix + i + '.png');
  }
  return files;
}

function createGalleryItem(name, description) {
  var column = document.createElement('div');
  column.className = 'column is-one-quarter-desktop is-one-third-tablet is-half-mobile gallery-item';

  var figure = document.createElement('figure');
  figure.className = 'image';

  var image = document.createElement('img');
  image.src = './static/images/' + name;
  image.alt = name.replace(/\.\w+$/, '');

  figure.appendChild(image);
  column.appendChild(figure);

  if (description) {
    var caption = document.createElement('p');
    caption.className = 'gallery-caption';
    caption.textContent = description;
    column.appendChild(caption);
  }
  return column;
}

function renderGallery(containerId, filenames) {
  var container = document.getElementById(containerId);
  if (!container) {
    return;
  }

  filenames.forEach(function(name) {
    container.appendChild(createGalleryItem(name));
  });
}

var mapDescriptions = {
  'Map1.png': 'Early-stage cluster map highlighting synthetic titles around multi-view reconstruction.',
  'Map2.png': 'Embedding of paper abstracts focused on transformer-based detectors.',
  'Map3.png': 'Graph of motion and deformation methods; nodes emphasize temporal consistency.',
  'Map4.png': 'Clustering of generative segmentation papers; edges link shared loss functions.',
  'Map5.png': 'Map of graph-neural-network approaches to vision matching problems.',
  'Map6.png': 'Cluster view of self-supervised vision methods with contrastive objectives.',
  'Map7.png': 'Spatial layout comparing 2D vs 3D understanding pipelines in the corpus.',
  'Map8.png': 'Outlier map showing fringe topics and low-density connections across clusters.'
};

function renderCarousel(containerId, filenames) {
  var container = document.getElementById(containerId);
  if (!container) {
    return;
  }

  filenames.forEach(function(name) {
    var slide = document.createElement('div');
    slide.className = 'gallery-slide';

    var figure = document.createElement('figure');
    figure.className = 'image';

    var image = document.createElement('img');
    image.src = './static/images/' + name;
    image.alt = name.replace(/\.\w+$/, '');

    figure.appendChild(image);
    slide.appendChild(figure);
    container.appendChild(slide);
  });
}

function setupContinuousMarquee(containerId, speedPxPerSec) {
  var container = document.getElementById(containerId);
  if (!container) {
    return;
  }

  var slides = Array.from(container.children);
  if (!slides.length) {
    return;
  }

  container.innerHTML = '';
  container.classList.add('marquee-wrapper');

  var prevBtn = document.createElement('button');
  prevBtn.className = 'marquee-arrow marquee-arrow-prev';
  prevBtn.setAttribute('aria-label', 'Previous');
  prevBtn.innerHTML = '←';

  var nextBtn = document.createElement('button');
  nextBtn.className = 'marquee-arrow marquee-arrow-next';
  nextBtn.setAttribute('aria-label', 'Next');
  nextBtn.innerHTML = '→';

  var viewport = document.createElement('div');
  viewport.className = 'marquee-viewport';

  var track = document.createElement('div');
  track.className = 'marquee-track';

  slides.forEach(function(slide) {
    track.appendChild(slide);
  });
  slides.forEach(function(slide) {
    track.appendChild(slide.cloneNode(true));
  });

  viewport.appendChild(track);
  container.appendChild(prevBtn);
  container.appendChild(viewport);
  container.appendChild(nextBtn);

  var lastTs = null;
  var offset = 0;
  var trackWidth = 0;
  var pxPerMs = Math.max(speedPxPerSec, 1) / 1000;

  var images = Array.from(track.querySelectorAll('img'));

  var updateWidth = function() {
    trackWidth = track.scrollWidth / 2;
  };

  Promise.all(images.map(function(img) {
    return new Promise(function(resolve) {
      if (img.complete) return resolve();
      img.onload = img.onerror = resolve;
    });
  })).then(updateWidth);

  window.addEventListener('resize', updateWidth);

  var tick = function(ts) {
    if (lastTs === null) lastTs = ts;
    var delta = ts - lastTs;
    offset += pxPerMs * delta;
    if (trackWidth > 0) {
      offset = offset % trackWidth;
    }
    track.style.transform = 'translateX(' + (-offset) + 'px)';
    lastTs = ts;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  var nudge = function(direction) {
    if (!trackWidth) return;
    var step = trackWidth / 25; // smaller step to make arrows less powerful
    offset = (offset + direction * step) % trackWidth;
    if (offset < 0) offset += trackWidth;
  };

  prevBtn.addEventListener('click', function() { nudge(-1); });
  nextBtn.addEventListener('click', function() { nudge(1); });
}

function extractMapTimeKey(filename) {
  var base = filename.replace(/\.[^.]+$/, '');
  var withoutPrefix = base.replace(/^map[_\-\s]*/i, '');
  if (!withoutPrefix) {
    return 'Unknown time';
  }

  var match = withoutPrefix.match(/(\d{1,2}(?::\d{2})?\s*(?:am|pm)?|\d{3,4})/i);
  var timeKey = match && match[1] ? match[1] : withoutPrefix;
  return timeKey.replace(/[_-]+/g, ' ').trim() || 'Unknown time';
}

function formatMapTimeLabel(timeKey) {
  return 'Map time: ' + timeKey;
}

function groupMapsByTime(filenames) {
  return filenames.reduce(function(groups, name) {
    var key = extractMapTimeKey(name);
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(name);
    return groups;
  }, {});
}

function sortMapTimeKeys(keys) {
  return keys.sort(function(a, b) {
    var numA = parseFloat(a);
    var numB = parseFloat(b);

    if (!isNaN(numA) && !isNaN(numB)) {
      return numA - numB;
    }
    return a.localeCompare(b);
  });
}

function renderMapGallery(containerId, filenames) {
  var container = document.getElementById(containerId);
  if (!container) {
    return;
  }

  container.innerHTML = '';

  var grouped = groupMapsByTime(filenames);
  var timeKeys = sortMapTimeKeys(Object.keys(grouped));

  timeKeys.forEach(function(timeKey) {
    var wrapper = document.createElement('div');
    wrapper.className = 'map-time-group';

    var heading = document.createElement('h4');
    heading.className = 'title is-5 map-time-title';
    heading.textContent = formatMapTimeLabel(timeKey);
    wrapper.appendChild(heading);

    var columns = document.createElement('div');
    columns.className = 'columns is-multiline is-mobile';

    grouped[timeKey].forEach(function(name) {
      columns.appendChild(createGalleryItem(name, mapDescriptions[name]));
    });

    wrapper.appendChild(columns);
    container.appendChild(wrapper);
  });
}

function setupImageModal() {
  var modal = document.getElementById('image-modal');
  if (!modal) {
    return;
  }
  var modalImage = document.getElementById('modal-image');
  var closeButtons = modal.querySelectorAll('.modal-background, .modal-close');

  var openModal = function(src, alt) {
    modalImage.src = src;
    modalImage.alt = alt || '';
    modal.classList.add('is-active');
  };

  var closeModal = function() {
    modal.classList.remove('is-active');
    modalImage.src = '';
    modalImage.alt = '';
  };

  $(document).on('click', '.gallery-slide img, #maps-gallery img', function() {
    openModal(this.src, this.alt);
  });

  closeButtons.forEach(function(btn) {
    btn.addEventListener('click', closeModal);
  });

  document.addEventListener('keyup', function(event) {
    if (event.key === 'Escape' && modal.classList.contains('is-active')) {
      closeModal();
    }
  });
}


$(document).ready(function() {
    // Check for click events on the navbar burger icon
    $(".navbar-burger").click(function() {
      // Toggle the "is-active" class on both the "navbar-burger" and the "navbar-menu"
      $(".navbar-burger").toggleClass("is-active");
      $(".navbar-menu").toggleClass("is-active");

    });

    /*var player = document.getElementById('interpolation-video');
    player.addEventListener('loadedmetadata', function() {
      $('#interpolation-slider').on('input', function(event) {
        console.log(this.value, player.duration);
        player.currentTime = player.duration / 100 * this.value;
      })
    }, false);*/
    preloadInterpolationImages();

    $('#interpolation-slider').on('input', function(event) {
      setInterpolationImage(this.value);
    });
    setInterpolationImage(0);
    $('#interpolation-slider').prop('max', NUM_INTERP_FRAMES - 1);

    bulmaSlider.attach();

    renderCarousel('papers-carousel', buildFileList('Paper', 11));
    renderMapGallery('maps-gallery', buildFileList('Map', 8));
    renderCarousel('figures-carousel', buildFileList('Fig', 13));
    setupImageModal();

    setupContinuousMarquee('papers-carousel', 60);
    setupContinuousMarquee('figures-carousel', 60);

    // Cluster selection for papers graph iframe
    var clusterSelect = document.getElementById('papers-cluster-select');
    var papersFrame = document.getElementById('papers-iframe');
    if (clusterSelect && papersFrame) {
      var sendCluster = function(clusterValue) {
        if (!papersFrame.contentWindow) return;
        var clusterId = clusterValue === 'all' ? null : parseInt(clusterValue, 10);
        papersFrame.contentWindow.postMessage({
          type: 'highlightCluster',
          cluster: isNaN(clusterId) ? null : clusterId
        }, '*');
      };

      clusterSelect.addEventListener('change', function() {
        sendCluster(this.value);
      });

      papersFrame.addEventListener('load', function() {
        sendCluster(clusterSelect.value || 'all');
      });
    }

    // Type selection for generated vs real figures graph iframe
    var figuresTypeSelect = document.getElementById('figures-type-select');
    var bothFiguresFrame = document.getElementById('both-figures-iframe');
    if (figuresTypeSelect && bothFiguresFrame) {
      var sendFigureType = function(typeValue) {
        if (!bothFiguresFrame.contentWindow) return;
        bothFiguresFrame.contentWindow.postMessage({
          type: 'highlightFigureType',
          figureType: typeValue === 'all' ? null : typeValue
        }, '*');
      };

      figuresTypeSelect.addEventListener('change', function() {
        sendFigureType(this.value);
      });

      bothFiguresFrame.addEventListener('load', function() {
        sendFigureType(figuresTypeSelect.value || 'all');
      });
    }

})
