use std::{
    fs::{File, OpenOptions},
    io,
    os::windows::{ffi::OsStrExt, fs::OpenOptionsExt, io::AsRawHandle},
    path::Path,
};
use windows_sys::Win32::Storage::FileSystem::{
    GetFileInformationByHandle, GetFileType, MoveFileExW, BY_HANDLE_FILE_INFORMATION,
    FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_OPEN_REPARSE_POINT,
    FILE_FLAG_WRITE_THROUGH, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE, FILE_TYPE_DISK,
    MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
};

fn information(file: &File) -> io::Result<BY_HANDLE_FILE_INFORMATION> {
    let mut info = BY_HANDLE_FILE_INFORMATION::default();
    // SAFETY: borrowed live File handle; writable correctly-sized output.
    if unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut info) } == 0 {
        return Err(io::Error::last_os_error());
    }
    // FileType/attributes are queried on the opened handle, not a followed
    // path. Reject all reparse points, directories, devices and hard links.
    if unsafe { GetFileType(file.as_raw_handle()) } != FILE_TYPE_DISK
        || info.dwFileAttributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT) != 0
        || info.nNumberOfLinks != 1
    {
        return Err(io::Error::other("Unsafe history artifact"));
    }
    Ok(info)
}
fn options(writable: bool) -> OpenOptions {
    let mut options = OpenOptions::new();
    options
        .read(true)
        .write(writable)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_WRITE_THROUGH);
    options
}
pub(crate) fn open_regular(path: &Path, writable: bool) -> io::Result<File> {
    let file = options(writable).open(path)?;
    information(&file)?;
    Ok(file)
}
pub(crate) fn create_new(path: &Path) -> io::Result<File> {
    // Rust's create_new is CREATE_NEW; no overwrite or reparse following.
    // Files inherit the user's app-data directory ACL; never write a raw key.
    let file = options(true).create_new(true).open(path)?;
    information(&file)?;
    Ok(file)
}
pub(crate) fn lock(path: &Path) -> io::Result<File> {
    // Allow other cooperating writers to open and wait, but not rename/delete
    // this lock inode while any waiter/owner holds it.
    let file = options(true)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
        .create(true)
        .truncate(false)
        .open(path)?;
    let before = information(&file)?;
    file.lock()?;
    // Attribute-only open avoids performing locked byte-range I/O on a
    // second handle. A same-user malicious actor is outside this contract.
    let current = options(false).access_mode(0).open(path)?;
    let after = information(&current)?;
    if (
        before.dwVolumeSerialNumber,
        before.nFileIndexHigh,
        before.nFileIndexLow,
    ) != (
        after.dwVolumeSerialNumber,
        after.nFileIndexHigh,
        after.nFileIndexLow,
    ) {
        return Err(io::Error::other("History transaction lock changed"));
    }
    Ok(file)
}
fn wide(path: &Path) -> io::Result<Vec<u16>> {
    // Canonicalize the parent (both names are in the same owned directory) to
    // get an extended-length absolute path without following the final name.
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::other("Invalid history path"))?;
    let name = path
        .file_name()
        .ok_or_else(|| io::Error::other("Invalid history path"))?;
    let absolute = parent.canonicalize()?.join(name);
    let mut wide: Vec<u16> = absolute.as_os_str().encode_wide().collect();
    if wide.contains(&0) {
        return Err(io::Error::other("Invalid history path"));
    }
    wide.push(0);
    Ok(wide)
}
pub(crate) fn publish(from: &Path, to: &Path, replace: bool) -> io::Result<()> {
    if from.parent() != to.parent() {
        return Err(io::Error::other(
            "History publication must stay in its directory",
        ));
    }
    let from = wide(from)?;
    let to = wide(to)?;
    let flags = MOVEFILE_WRITE_THROUGH
        | if replace {
            MOVEFILE_REPLACE_EXISTING
        } else {
            0
        };
    // No cross-volume copy fallback, no link/unlink intermediate. Without
    // REPLACE_EXISTING an existing destination wins and remains unchanged.
    // SAFETY: both NUL-terminated buffers live for the duration of the call.
    if unsafe { MoveFileExW(from.as_ptr(), to.as_ptr(), flags) } == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}
pub(crate) fn sync_publication(_dir: &Path, published: &Path) -> io::Result<()> {
    // FlushFileBuffers (File::sync_all) flushes the published file's data AND
    // metadata. Reopen with GENERIC_WRITE as that API requires. Repeated on
    // dedup retries and persisted key reads, before authorizing source loss.
    // MOVEFILE_WRITE_THROUGH alone is NOT a general directory fsync promise.
    // Windows has no unprivileged portable directory-fsync equivalent: this
    // is a file/metadata publication fence, not a deletion or whole-volume
    // power-loss guarantee. A crash can leave a legacy tmp name to retry.
    // Unsupported flush/sharing/access errors are propagated, never ignored.
    open_regular(published, true)?.sync_all()
}
