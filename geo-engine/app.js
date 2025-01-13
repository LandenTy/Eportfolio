// JavaScript for toggling the sliding menu
document.getElementById('hamburger-icon').addEventListener('click', function (event) {
    const navbarLinks = document.getElementById('navbar-links');

    // Toggle the 'active' class for the sliding menu
    navbarLinks.classList.toggle('active');

    // Stop the click event from propagating to the document
    event.stopPropagation();
});

// Close the menu when clicking outside of it
document.addEventListener('click', function (event) {
    const navbarLinks = document.getElementById('navbar-links');
    const hamburgerIcon = document.getElementById('hamburger-icon');

    // Check if the click is outside the navbar or hamburger icon
    if (!navbarLinks.contains(event.target) && !hamburgerIcon.contains(event.target)) {
        navbarLinks.classList.remove('active');
    }
});


// Download Button Ripple Effect
document.getElementById('download-btn').addEventListener('click', function (event) {
    const button = event.currentTarget;

    // Create the ripple element
    const ripple = document.createElement('span');
    ripple.classList.add('ripple');

    // Calculate the position of the ripple
    const rect = button.getBoundingClientRect();
    const rippleSize = Math.max(rect.width, rect.height);
    const x = event.clientX - rect.left - rippleSize / 2;
    const y = event.clientY - rect.top - rippleSize / 2;

    // Apply styles to position and size the ripple
    ripple.style.width = ripple.style.height = `${rippleSize}px`;
    ripple.style.left = `${x}px`;
    ripple.style.top = `${y}px`;

    // Add the ripple to the button
    button.appendChild(ripple);

    // Remove the ripple after the animation ends
    ripple.addEventListener('animationend', () => {
        ripple.remove();
    });
});

// Toggle user dropdown visibility
document.getElementById('user-icon').addEventListener('click', function(event) {
    const dropdown = document.getElementById('user-dropdown');
    dropdown.style.display = (dropdown.style.display === 'block') ? 'none' : 'block';
    event.stopPropagation(); // Prevents the click from propagating and closing the dropdown immediately
});

// Close the dropdown when clicking outside of it
document.addEventListener('click', function(event) {
    const dropdown = document.getElementById('user-dropdown');
    const userMenu = document.getElementById('user-menu');
    
    if (!userMenu.contains(event.target)) {
        dropdown.style.display = 'none';
    }
});

/* 
    ////////////////////////////////////////////////////////
                        ABOUT GEO SECTION
    ////////////////////////////////////////////////////////
*/

// Disable right-click on images
document.getElementById("image").addEventListener("contextmenu", function(event) {
    event.preventDefault(); // Prevent right-click menu
});  