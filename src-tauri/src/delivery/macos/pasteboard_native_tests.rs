//! In-memory AppKit objects only. Never get a general/named pasteboard.
use super::*;
use objc2::runtime::NSObject;
use objc2::{define_class, AnyThread, DefinedClass};
use std::cell::{Cell, RefCell};

struct MemoryState {
    items: RefCell<Option<Retained<AnyObject>>>,
    count: Cell<isize>,
    copy_in_clear: Cell<bool>,
    fail_write: Cell<bool>,
    calls: RefCell<Vec<&'static str>>,
}

// NSObject fixture, NOT an NSPasteboard. Only these in-memory selectors run.
define_class!(
    #[unsafe(super(NSObject))]
    #[name = "VoxloomInMemoryClipboardBoundaryFixture"]
    #[ivars = MemoryState]
    struct MemoryBoard;

    impl MemoryBoard {
        #[unsafe(method(changeCount))]
        fn change_count(&self) -> isize { self.ivars().count.get() }

        #[unsafe(method(pasteboardItems))]
        fn pasteboard_items(&self) -> *mut AnyObject {
            self.ivars().items.borrow().as_ref().map_or(std::ptr::null_mut(), |a| Retained::as_ptr(a).cast_mut())
        }

        #[unsafe(method(prepareForNewContentsWithOptions:))]
        fn prepare_contents(&self, options: usize) -> isize {
            assert_eq!(options, 1, "CurrentHostOnly must be explicit");
            let state = self.ivars();
            state.calls.borrow_mut().push("clear");
            state.items.borrow_mut().take();
            state.count.set(state.count.get() + if state.copy_in_clear.get() { 2 } else { 1 });
            state.count.get()
        }

        #[unsafe(method(writeObjects:))]
        fn write_objects(&self, items: *mut AnyObject) -> Bool {
            let state = self.ivars();
            state.calls.borrow_mut().push("write");
            if state.fail_write.get() { return Bool::NO; }
            *state.items.borrow_mut() = unsafe { Retained::retain(items) };
            Bool::YES
        }
    }
);

fn memory_board(items: Option<Retained<AnyObject>>) -> Retained<MemoryBoard> {
    let allocated = MemoryBoard::alloc().set_ivars(MemoryState {
        items: RefCell::new(items),
        count: Cell::new(10),
        copy_in_clear: Cell::new(false),
        fail_write: Cell::new(false),
        calls: RefCell::default(),
    });
    unsafe { msg_send![super(allocated), init] }
}

#[test]
fn native_nil_items_refuse_but_real_empty_array_is_a_valid_empty_snapshot() {
    autoreleasepool(|_| {
        let fixture = memory_board(None);
        let board = AppKitBoard(Retained::as_ptr(&fixture).cast_mut().cast());
        assert!(policy::capture(&board).is_err());
        let empty = board.prepare(&[]).unwrap();
        *fixture.ivars().items.borrow_mut() = Some(empty);
        assert!(policy::capture(&board).unwrap().items.is_empty());
        assert!(fixture.ivars().calls.borrow().is_empty());
    });
}

#[test]
fn native_snapshot_items_retain_original_objects_after_source_array_is_replaced() {
    autoreleasepool(|_| {
        let fixture = memory_board(None);
        let board = AppKitBoard(Retained::as_ptr(&fixture).cast_mut().cast());
        let original = policy::transient_items("original");
        *fixture.ivars().items.borrow_mut() = Some(board.prepare(&original).unwrap());
        let pinned = board.items(policy::MAX_ITEMS).unwrap();
        *fixture.ivars().items.borrow_mut() =
            Some(board.prepare(&policy::transient_items("new")).unwrap());
        assert_eq!(
            board
                .data(&pinned[0], policy::STRING, policy::MAX_BYTES)
                .unwrap(),
            b"original"
        );
        assert_eq!(
            board
                .types(&pinned[0], policy::MAX_TYPES_PER_ITEM)
                .unwrap()
                .len(),
            4
        );
    });
}

#[test]
fn native_publication_stages_run_through_actual_objc_boundary_without_a_pasteboard() {
    autoreleasepool(|_| {
        let fixture = memory_board(None);
        let board = AppKitBoard(Retained::as_ptr(&fixture).cast_mut().cast());
        let items = policy::transient_items("test");
        assert_eq!(policy::replace(&board, 10, &items, true), Ok(11));
        assert_eq!(*fixture.ivars().calls.borrow(), ["clear", "write"]);
        fixture.ivars().fail_write.set(true);
        assert!(matches!(
            policy::replace(&board, 11, &items, true),
            Err(PublicationFailure::Owned { generation: 12, .. })
        ));
        fixture.ivars().copy_in_clear.set(true);
        fixture.ivars().calls.borrow_mut().clear();
        assert!(matches!(
            policy::replace(&board, 12, &items, true),
            Err(PublicationFailure::Unknown(_))
        ));
        assert_eq!(*fixture.ivars().calls.borrow(), ["clear"]);
    });
}

#[test]
fn prepared_items_roundtrip_all_formats_without_opening_a_pasteboard() {
    autoreleasepool(|_| unsafe {
        // prepare/types/data MUST NOT dereference the pasteboard itself.
        let board = AppKitBoard(std::ptr::null_mut());
        let saved = vec![
            vec![
                ("public.rtf".into(), vec![0, 255, 4]),
                (policy::STRING.into(), "café 世界 🙂\n".as_bytes().to_vec()),
            ],
            vec![
                ("public.png".into(), vec![9, 0, 8]),
                ("test.empty".into(), vec![]),
            ],
        ];
        let prepared = board.prepare(&saved).unwrap();
        let count: usize = msg_send![&*prepared, count];
        assert_eq!(count, saved.len());
        for (i, entries) in saved.iter().enumerate() {
            let item: Retained<AnyObject> = msg_send![&*prepared, objectAtIndex: i];
            assert_eq!(
                board.types(&item, policy::MAX_TYPES_PER_ITEM).unwrap(),
                entries.iter().map(|(ty, _)| ty.clone()).collect::<Vec<_>>()
            );
            for (ty, bytes) in entries {
                assert_eq!(board.data(&item, ty, policy::MAX_BYTES).unwrap(), *bytes);
            }
            assert!(board
                .data(&item, "test.missing", policy::MAX_BYTES)
                .is_err());
        }
    });
}

#[test]
fn prepared_transcript_markers_are_attached_before_any_pasteboard_access() {
    autoreleasepool(|_| unsafe {
        let board = AppKitBoard(std::ptr::null_mut());
        let saved = policy::transient_items("hello\n世界");
        let prepared = board.prepare(&saved).unwrap();
        let item: Retained<AnyObject> = msg_send![&*prepared, objectAtIndex: 0usize];
        for (ty, bytes) in &saved[0] {
            assert_eq!(board.data(&item, ty, policy::MAX_BYTES).unwrap(), *bytes);
        }
        assert!(board
            .prepare(&[vec![("bad\0type".into(), vec![])]])
            .is_err());
        assert!(board.types(&item, 1).is_err());
        assert!(board.data(&item, policy::STRING, 1).is_err());
    });
}
