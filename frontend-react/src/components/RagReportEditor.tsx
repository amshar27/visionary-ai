import { forwardRef, useImperativeHandle } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import {
  Heading3,
  Bold as BoldIcon,
  Italic as ItalicIcon,
  List,
  ListOrdered,
  Undo2,
  Redo2,
} from 'lucide-react';

export type RagReportEditorHandle = {
  getMarkdown: () => string;
};

type Props = {
  initialMarkdown: string;
  onChange?: (markdown: string) => void;
};

// Toolbar button — highlights when the editor reports the mark/node active.
function TbBtn({
  active,
  disabled,
  onClick,
  title,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`px-2 py-1 rounded-md text-sm font-semibold transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
        active
          ? 'bg-blue-100 text-blue-700 border border-blue-300'
          : 'text-gray-700 border border-transparent hover:bg-gray-100'
      }`}
    >
      {children}
    </button>
  );
}

const RagReportEditor = forwardRef<RagReportEditorHandle, Props>(
  ({ initialMarkdown, onChange }, ref) => {
    const editor = useEditor({
      extensions: [
        StarterKit,
        // Markdown extension parses initial content as markdown and exposes
        // editor.storage.markdown.getMarkdown() for serializing back out.
        Markdown.configure({
          html: false,
          tightLists: true,
          transformPastedText: true,
          breaks: false,
        }),
      ],
      content: initialMarkdown,
      onUpdate: ({ editor }) => {
        if (onChange) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const md = (editor.storage as any).markdown?.getMarkdown?.() ?? '';
          onChange(md);
        }
      },
    });

    useImperativeHandle(
      ref,
      () => ({
        getMarkdown: () => {
          if (!editor) return '';
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (editor.storage as any).markdown?.getMarkdown?.() ?? '';
        },
      }),
      [editor]
    );

    return (
      <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-1 px-2 py-1.5 border-b border-gray-200 bg-gray-50">
          <TbBtn
            title="Heading 3"
            active={editor?.isActive('heading', { level: 3 })}
            onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
          >
            <Heading3 size={16} />
          </TbBtn>
          <TbBtn
            title="Bold"
            active={editor?.isActive('bold')}
            onClick={() => editor?.chain().focus().toggleBold().run()}
          >
            <BoldIcon size={16} />
          </TbBtn>
          <TbBtn
            title="Italic"
            active={editor?.isActive('italic')}
            onClick={() => editor?.chain().focus().toggleItalic().run()}
          >
            <ItalicIcon size={16} />
          </TbBtn>
          <span className="w-px h-5 bg-gray-300 mx-1" />
          <TbBtn
            title="Bullet list"
            active={editor?.isActive('bulletList')}
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
          >
            <List size={16} />
          </TbBtn>
          <TbBtn
            title="Numbered list"
            active={editor?.isActive('orderedList')}
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          >
            <ListOrdered size={16} />
          </TbBtn>
          <span className="w-px h-5 bg-gray-300 mx-1" />
          <TbBtn
            title="Undo"
            disabled={!editor?.can().undo()}
            onClick={() => editor?.chain().focus().undo().run()}
          >
            <Undo2 size={16} />
          </TbBtn>
          <TbBtn
            title="Redo"
            disabled={!editor?.can().redo()}
            onClick={() => editor?.chain().focus().redo().run()}
          >
            <Redo2 size={16} />
          </TbBtn>
        </div>

        {/* Editor surface — view-mode typography via @tailwindcss/typography. */}
        <EditorContent
          editor={editor as Editor}
          className="rag-editor prose prose-sm md:prose-base max-w-none px-5 py-5 text-gray-700 focus:outline-none"
        />

        {/* Local overrides so the editing surface matches view-mode RAG layout
            (h3 + bold labels + bulleted lists, no markdown syntax visible). */}
        <style>{`
          .rag-editor .ProseMirror {
            min-height: 300px;
            outline: none;
          }
          .rag-editor .ProseMirror h3 {
            font-size: 17px;
            font-weight: 500;
            color: #374151;
            border-bottom: 1px solid #e5e7eb;
            padding-bottom: 4px;
            margin-top: 1.4em;
            margin-bottom: 0.6em;
          }
          .rag-editor .ProseMirror strong {
            color: #111827;
            font-weight: 600;
          }
          .rag-editor .ProseMirror ul,
          .rag-editor .ProseMirror ol {
            padding-left: 1.4em;
          }
          .rag-editor .ProseMirror p {
            margin: 0.4em 0;
          }
        `}</style>
      </div>
    );
  }
);

RagReportEditor.displayName = 'RagReportEditor';

export default RagReportEditor;
