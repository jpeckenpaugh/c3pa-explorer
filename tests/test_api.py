import csv
import io
import json
import unittest
import zipfile
from fastapi.testclient import TestClient
from backend.main import app


class TestAPI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    def test_index(self):
        res = self.client.get("/")
        self.assertEqual(res.status_code, 200)

    def test_stats(self):
        res = self.client.get("/api/stats")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("documents", data)
        self.assertIn("units", data)
        self.assertIn("sentences", data)
        self.assertIn("fragments", data)

    def test_labels(self):
        res = self.client.get("/api/labels")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIsInstance(data, list)

    def test_fragment_types(self):
        res = self.client.get("/api/fragment-types")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIsInstance(data, list)

    def test_documents_list(self):
        res = self.client.get("/api/documents")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("total", data)
        self.assertIn("rows", data)

    def test_documents_order(self):
        res = self.client.get("/api/documents/order")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("order", data)

    def test_document_detail(self):
        res = self.client.get("/api/documents/DB_1")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("document", data)
        self.assertIn("units", data)

    def test_document_rendered(self):
        res = self.client.get("/api/documents/DB_1/rendered")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("blocks", data)

    def test_document_annotations(self):
        res = self.client.get("/api/documents/DB_1/annotations")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("annotations", data)

    def test_document_html(self):
        res = self.client.get("/api/documents/DB_1/html")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("text", data)

    def test_units_filter(self):
        res = self.client.get("/api/units?subset=DB&unit_kind=sentence&category=single_label")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("total", data)
        self.assertIn("rows", data)

    def test_alignment(self):
        res = self.client.get("/api/alignment?unit_id=DB_1_U1")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("rows", data)

    def test_annotations(self):
        res = self.client.get("/api/annotations")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("rows", data)

    def test_annotation_detail(self):
        res = self.client.get("/api/annotations/1")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("aligned_units", data)

    def test_search(self):
        res = self.client.get("/api/search?q=privacy")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("documents", data)
        self.assertIn("units", data)

    def test_export_csv(self):
        res = self.client.get("/api/export?format=csv&split_train=70&split_eval=15&split_test=15")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.headers["content-type"], "application/zip")
        with zipfile.ZipFile(io.BytesIO(res.content)) as zf:
            names = zf.namelist()
            self.assertIn("meta.json", names)
            csv_files = [n for n in names if n.endswith(".csv")]
            self.assertEqual(len(csv_files), 3)
            train_file = next((f for f in csv_files if f.startswith("train_")), None)
            eval_file = next((f for f in csv_files if f.startswith("eval_")), None)
            test_file = next((f for f in csv_files if f.startswith("test_")), None)
            self.assertIsNotNone(train_file)
            self.assertIsNotNone(eval_file)
            self.assertIsNotNone(test_file)
            content = zf.read(train_file).decode("utf-8")
            header_line = content.splitlines()[0]
            self.assertEqual(header_line, "id,doc_id,text,label,label_name,split")



    def test_export_json(self):
        res = self.client.get("/api/export?format=json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.headers["content-type"], "application/zip")
        with zipfile.ZipFile(io.BytesIO(res.content)) as zf:
            names = zf.namelist()
            self.assertIn("meta.json", names)
            meta = json.loads(zf.read("meta.json").decode("utf-8"))
            self.assertEqual(meta["split"]["grouped_by"], "doc_id")
            self.assertIn("grouping_note", meta)

            # Verify zero document-level data leakage across splits
            doc_splits: dict[str, set[str]] = {}
            for name in names:
                if name == "meta.json" or not name.endswith(".json"):
                    continue
                split_name = name.split("_")[0]
                units = json.loads(zf.read(name).decode("utf-8"))
                for u in units:
                    doc_id = u["doc_id"] if "doc_id" in u else u["group"]
                    doc_splits.setdefault(doc_id, set()).add(split_name)

            for doc_id, splits in doc_splits.items():
                self.assertEqual(
                    len(splits), 1,
                    f"Document leakage detected for {doc_id}: found in multiple splits {splits}"
                )

    def test_export_json_stratified(self):
        res = self.client.get("/api/export?format=json&stratify=true")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.headers["content-type"], "application/zip")
        with zipfile.ZipFile(io.BytesIO(res.content)) as zf:
            names = zf.namelist()
            doc_splits: dict[str, set[str]] = {}
            for name in names:
                if name == "meta.json" or not name.endswith(".json"):
                    continue
                split_name = name.split("_")[0]
                units = json.loads(zf.read(name).decode("utf-8"))
                for u in units:
                    doc_id = u["doc_id"] if "doc_id" in u else u["group"]
                    doc_splits.setdefault(doc_id, set()).add(split_name)

            for doc_id, splits in doc_splits.items():
                self.assertEqual(
                    len(splits), 1,
                    f"Document leakage detected in stratified export for {doc_id}: found in splits {splits}"
                )

    def test_export_custom_fields(self):
        res = self.client.get("/api/export?format=json&fields=id,group,text,label,label_name,split")
        self.assertEqual(res.status_code, 200)
        with zipfile.ZipFile(io.BytesIO(res.content)) as zf:
            meta = json.loads(zf.read("meta.json").decode("utf-8"))
            self.assertEqual(meta["selected_fields"], ["id", "group", "text", "label", "label_name", "split"])
            train_file = next(f for f in zf.namelist() if f.startswith("train_"))
            units = json.loads(zf.read(train_file).decode("utf-8"))
            sample_unit = units[0]
            self.assertEqual(set(sample_unit.keys()), {"id", "group", "text", "label", "label_name", "split"})

        res_csv = self.client.get("/api/export?format=csv&fields=id,group,text,label,split")
        self.assertEqual(res_csv.status_code, 200)
        with zipfile.ZipFile(io.BytesIO(res_csv.content)) as zf:
            train_file = next(f for f in zf.namelist() if f.startswith("train_"))
            header_line = zf.read(train_file).decode("utf-8").splitlines()[0]
            self.assertEqual(header_line, "id,group,text,label,split")

    def test_export_max_doc_cap(self):
        res = self.client.get("/api/export?format=json&max_doc_label_pct=20")
        self.assertEqual(res.status_code, 200)
        with zipfile.ZipFile(io.BytesIO(res.content)) as zf:
            meta = json.loads(zf.read("meta.json").decode("utf-8"))
            self.assertEqual(meta["max_doc_label_pct"], 20.0)
            self.assertIn("capped_units_removed", meta)
            self.assertIn("label_distribution", meta)
            self.assertIn("label_support_analysis", meta)
            self.assertIn("cross_split_text_overlap", meta)

    def test_export_preview(self):
        res = self.client.get("/api/export/preview?format=csv&split_train=70&split_eval=15&split_test=15&max_doc_label_pct=25")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data["valid"])
        self.assertIn("total_units", data)
        self.assertIn("counts", data)
        self.assertIn("label_distribution", data)
        self.assertIn("label_support_analysis", data)
        self.assertIn("cross_split_text_overlap", data)
        self.assertEqual(data["max_doc_label_pct"], 25.0)


if __name__ == "__main__":
    unittest.main()

