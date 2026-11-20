use std::{
    ffi::CString,
    fs::{self, File, OpenOptions},
    io,
    os::unix::{
        ffi::OsStrExt,
        fs::{MetadataExt, OpenOptionsExt},
    },
    path::Path,
};

fn check(file: &File) -> io::Result<()> {
    let meta = file.metadata()?;
    if !meta.is_file() || meta.nlink() != 1 {
        return Err(io::Error::other("Unsafe history artifact"));
    }
    Ok(())
}
pub(crate) fn open_regular(path: &Path, writable: bool) -> io::Result<File> {
    let file = OpenOptions::new()
        .read(true)
        .write(writable)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)?;
    check(&file)?;
    Ok(file)
}
pub(crate) fn create_new(path: &Path) -> io::Result<File> {
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)
}
pub(crate) fn lock(path: &Path) -> io::Result<File> {
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)?;
    check(&file)?;
    let meta = file.metadata()?;
    file.lock()?;
    let current = fs::symlink_metadata(path)?;
    if current.dev() != meta.dev() || current.ino() != meta.ino() {
        return Err(io::Error::other("History transaction lock changed"));
    }
    Ok(file)
}
pub(crate) fn publish(from: &Path, to: &Path, replace: bool) -> io::Result<()> {
    if replace {
        return fs::rename(from, to);
    }
    let from = CString::new(from.as_os_str().as_bytes())?;
    let to = CString::new(to.as_os_str().as_bytes())?;
    // Exclusive rename avoids the unreadable double-link crash window of
    // link/unlink. Both C strings live through the call, no pointers retained.
    if unsafe { libc::renamex_np(from.as_ptr(), to.as_ptr(), libc::RENAME_EXCL) } != 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}
pub(crate) fn sync_publication(dir: &Path, _published: &Path) -> io::Result<()> {
    File::open(dir)?.sync_all()
}
