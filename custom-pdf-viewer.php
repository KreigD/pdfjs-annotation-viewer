<?php
   /*
   Plugin Name: Custom PDF Viewer
   description: A plugin to allow the user to view and annotate PDFs, custom for Oliver Rose, LLC.
   */
?>

<?php


add_action( 'wp_enqueue_scripts', 'pdf_enqueue_scripts', 15 );
function pdf_enqueue_scripts() {

  // JS Files
  wp_enqueue_script( 'webviewer-js', plugin_dir_url( __FILE__ ) . '/js/WebViewer.min.js', array( 'jquery' ), true );
  wp_enqueue_script( 'pdf-js', plugin_dir_url( __FILE__ ) . '/pdfjs/build/pdf.js', array( 'jquery' ), true );
  wp_enqueue_script( 'custom-pdf-js', plugin_dir_url( __FILE__ ) . '/js/custom-pdf.js', array( 'jquery' ), true );

  // CSS File
  wp_enqueue_style( 'custom-pdf-css', plugin_dir_url( __FILE__ ) . '/css/custom-pdf.css' );

  // Add pdf file url and site url to a global variable to make PDFtron WebViewer work
  $translation_array = array(
    'pdfurl' => get_field('file'),
    'siteurl' => get_site_url(),
    'themeurl' => get_stylesheet_directory_uri()
  );
  wp_localize_script( 'child-understrap-scripts', 'WP_URLS', $translation_array );

}



?>