// Lambda doesn't contain either aws cli or zip command
// This was the easiest workaround I could find...

const gulp = require('gulp');
const zip = require('gulp-zip');
const s3 = require('gulp-s3-upload')();

gulp.task('package', () =>
  {
    gulp.src('packaged/**/*')
        .pipe(zip('packaged.zip'))
        .pipe(s3({
          Bucket: 'voip-ms-monitor-build-artifacts'
        }));
  }
);