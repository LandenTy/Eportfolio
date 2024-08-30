$(document).ready(function(){
    $("a").on('click', function(event) {
      if (this.hash !== "") {
        event.preventDefault();

        var hash = this.hash;
        $('html, body').animate({
          scrollTop: $(hash).offset().top
        }, 800, function(){
          window.location.hash = hash;
        });
      }
    });
});

document.addEventListener("DOMContentLoaded", function () {
  const projectButtons = document.querySelectorAll(".project-button");
  const overlays = document.querySelectorAll(".overlay");

  projectButtons.forEach((button, index) => {
    button.addEventListener("click", () => {
      // Close all open overlays
      overlays.forEach((overlay) => {
        overlay.style.display = "none";
      });

      // Open the selected overlay
      const projectId = button.getAttribute("data-project");
      const overlay = document.getElementById(`${projectId}-overlay`);
      overlay.style.display = "block";
      document.getElementById('video').play();
    });
  });

  overlays.forEach((overlay) => {
    const closeButton = overlay.querySelector(".close-button");
    closeButton.addEventListener("click", () => {
      overlay.style.display = "none";
    });

    const carousel = overlay.querySelector(".carousel");
    const images = carousel.querySelectorAll("img");
    const videos = carousel.querySelectorAll("video");
    let currentIndex = 0;

    setInterval(() => {
      images[currentIndex].style.transform = "translateX(-100%)";
      currentIndex = (currentIndex + 1) % images.length;
      currentIndex = (currentIndex + 1) % videos.length;
      images[currentIndex].style.transform = "translateX(0)";
    }, 3000);
  });
});
